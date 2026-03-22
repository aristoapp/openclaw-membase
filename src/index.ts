import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MembaseClient } from "./client";
import { registerCli, upsertPluginConfig } from "./commands/cli";
import {
  isRedactedTokenValue,
  parseConfig,
  readTokenFile,
  resolveTokenFilePath,
  writeTokenFile,
} from "./config";
import { flushAllBuffers, registerCaptureHook } from "./hooks/capture";
import { registerRecallHook } from "./hooks/recall";
import { registerForgetTool } from "./tools/forget";
import { registerProfileTool } from "./tools/profile";
import { registerSearchTool } from "./tools/search";
import { registerStoreTool } from "./tools/store";
import type { OpenClawPluginApi } from "./types";

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function hasTokenValues(tokens: TokenPair): boolean {
  return Boolean(tokens.accessToken || tokens.refreshToken);
}

function normalizeLegacyTokenValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return isRedactedTokenValue(value) ? "" : value;
}

function readTokensFromConfigObject(
  config: Record<string, unknown>,
): TokenPair {
  return {
    accessToken: normalizeLegacyTokenValue(config.accessToken),
    refreshToken: normalizeLegacyTokenValue(config.refreshToken),
  };
}

function readRawPluginConfigFromDisk(
  logger: OpenClawPluginApi["logger"],
): Record<string, unknown> {
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  try {
    const root = asObject(JSON.parse(readFileSync(configPath, "utf-8")));
    const plugins = asObject(root.plugins);
    const entries = asObject(plugins.entries);
    const entry = asObject(entries["openclaw-membase"]);
    return asObject(entry.config);
  } catch (error) {
    logger.warn(
      `membase: failed to read ${configPath} during token migration: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}

export default {
  id: "openclaw-membase",
  name: "Membase",
  description: "OpenClaw memory plugin backed by Membase",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    const rawPluginConfig = api.pluginConfig ?? {};
    const tokenFile = resolveTokenFilePath(rawPluginConfig);
    const pluginConfigTokens = readTokensFromConfigObject(rawPluginConfig);
    const hasLegacyTokenValues = hasTokenValues(pluginConfigTokens);
    const hasRedactedLegacyTokens =
      isRedactedTokenValue(rawPluginConfig.accessToken) ||
      isRedactedTokenValue(rawPluginConfig.refreshToken);

    let shouldClearLegacyTokens = false;
    if (hasLegacyTokenValues || hasRedactedLegacyTokens) {
      const tokenFilePair = readTokenFile(tokenFile, api.logger);
      if (hasTokenValues(tokenFilePair)) {
        shouldClearLegacyTokens = true;
      } else {
        let recoveredTokens = pluginConfigTokens;
        if (
          !recoveredTokens.accessToken ||
          !recoveredTokens.refreshToken ||
          hasRedactedLegacyTokens
        ) {
          const diskConfigTokens = readTokensFromConfigObject(
            readRawPluginConfigFromDisk(api.logger),
          );
          recoveredTokens = {
            accessToken:
              recoveredTokens.accessToken || diskConfigTokens.accessToken,
            refreshToken:
              recoveredTokens.refreshToken || diskConfigTokens.refreshToken,
          };
        }

        if (hasTokenValues(recoveredTokens)) {
          writeTokenFile(tokenFile, recoveredTokens);
          shouldClearLegacyTokens = true;
          api.logger.info(
            "membase: migrated legacy OAuth tokens to token file",
          );
        } else {
          api.logger.warn(
            hasRedactedLegacyTokens
              ? "membase: legacy tokens are redacted and no recoverable token was found. Keeping existing plugin config; run 'openclaw membase login' once to repair."
              : "membase: no recoverable legacy tokens found during migration. Keeping existing plugin config unchanged.",
          );
        }
      }
    }

    const cfg = parseConfig(rawPluginConfig, api.logger);
    if (shouldClearLegacyTokens) {
      Promise.resolve()
        .then(() =>
          upsertPluginConfig({
            apiUrl: cfg.apiUrl,
            clientId: cfg.clientId,
            tokenFile: cfg.tokenFile,
            accessToken: "",
            refreshToken: "",
          }),
        )
        .then(() => {
          api.logger.info(
            "membase: cleared legacy OAuth tokens from plugin config",
          );
        })
        .catch((err) =>
          api.logger.error(
            "membase: failed to clear legacy OAuth tokens from plugin config",
            err,
          ),
        );
    }

    const client = new MembaseClient(
      cfg.apiUrl.replace(/\/$/, ""),
      {
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        clientId: cfg.clientId,
      },
      {
        debug: cfg.debug,
        logger: api.logger,
        onTokenRefresh: (tokens) => {
          try {
            writeTokenFile(cfg.tokenFile, {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            });
          } catch (err) {
            api.logger.error(
              "membase: failed to persist refreshed tokens",
              err,
            );
          }
        },
      },
    );

    if (!client.isAuthenticated()) {
      api.logger.warn(
        "membase: missing valid OAuth tokens. Run 'openclaw membase login' to re-authenticate.",
      );
      let noticeDelivered = false;
      api.on(
        "before_agent_start",
        () => {
          if (noticeDelivered) return {};
          noticeDelivered = true;
          return {
            prependContext:
              "<membase-notice>\n" +
              "Membase long-term memory is disconnected — OAuth tokens are missing or invalid. " +
              "Inform the user exactly once at the start of this conversation: " +
              "\"Membase memory is not connected. Run 'openclaw membase login' in your terminal to reconnect.\" " +
              "Do not repeat this notice.\n" +
              "</membase-notice>",
          };
        },
        { priority: 10 },
      );
      registerCli(api, client);
      return;
    }

    registerSearchTool(api, client);
    registerStoreTool(api, client);
    registerProfileTool(api, client);
    registerForgetTool(api, client);

    if (cfg.autoRecall) {
      registerRecallHook(api, client, cfg);
    }
    if (cfg.autoCapture) {
      registerCaptureHook(api, client, api.logger);
    }

    registerCli(api, client);

    api.registerService({
      id: "openclaw-membase",
      start: () => {
        api.logger.info(
          `membase: connected (recall: ${cfg.autoRecall}, capture: ${cfg.autoCapture})`,
        );
        client.registerConnection().catch(() => {});
      },
      stop: async () => {
        if (cfg.autoCapture) {
          await flushAllBuffers(client, api.logger);
        }
        api.logger.info("membase: stopped");
      },
    });
  },
};
