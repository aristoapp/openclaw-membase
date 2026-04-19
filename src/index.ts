import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MembaseClient } from "./client";
import {
  ensureToolsAllowlist,
  registerCli,
  upsertPluginConfig,
} from "./commands/cli";
import {
  DEFAULT_TOKEN_FILE_PATH,
  isInsideExtensionsDir,
  isRedactedTokenValue,
  parseConfig,
  readTokenFile,
  resolveTokenFilePath,
  writeTokenFile,
} from "./config";
import { flushAllBuffers, registerCaptureHook } from "./hooks/capture";
import { registerRecallHook } from "./hooks/recall";
import { registerAddWikiTool } from "./tools/add-wiki";
import { registerDeleteWikiTool } from "./tools/delete-wiki";
import { registerForgetTool } from "./tools/forget";
import { registerProfileTool } from "./tools/profile";
import { registerSearchTool } from "./tools/search";
import { registerSearchWikiTool } from "./tools/search-wiki";
import { registerStoreTool } from "./tools/store";
import { registerUpdateWikiTool } from "./tools/update-wiki";
import type { OpenClawPluginApi } from "./types";
import { startBackgroundUpdateCheck } from "./update-check";

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

    // ── Token file path migration ────────────────────────────────────────────
    // extensions/ is fully replaced on every plugin update/reinstall, so any
    // token file stored there will be silently deleted. Detect that pattern and
    // move to the safe credentials/ location before doing anything else.
    const configuredTokenFile = resolveTokenFilePath(rawPluginConfig);
    let effectiveTokenFile = configuredTokenFile;
    let pathMigrationPromise: Promise<void> | null = null;

    if (isInsideExtensionsDir(configuredTokenFile)) {
      effectiveTokenFile = DEFAULT_TOKEN_FILE_PATH;
      const oldTokens = readTokenFile(configuredTokenFile, api.logger);

      if (hasTokenValues(oldTokens)) {
        // Old file still exists — copy it to the safe location before it vanishes.
        try {
          writeTokenFile(effectiveTokenFile, oldTokens);
          api.logger.info(
            `membase: moved token file from extensions/ to credentials/ (safe from updates)`,
          );
        } catch (err) {
          api.logger.error(
            "membase: failed to move token file to credentials/",
            err,
          );
        }
      }

      // Update tokenFile in openclaw.json asynchronously so next boot uses the
      // safe path directly (no migration needed again).
      // NOTE: stored in a variable so the legacy-token clear below can chain
      // onto it and avoid a read/write race on openclaw.json.
      pathMigrationPromise = upsertPluginConfig({
        tokenFile: effectiveTokenFile,
      }).catch((err) =>
        api.logger.error(
          "membase: failed to update tokenFile path in plugin config",
          err,
        ),
      );
    }
    // ────────────────────────────────────────────────────────────────────────

    // Inject the resolved (possibly migrated) tokenFile so all downstream
    // reads use the safe path within this boot cycle.
    const effectivePluginConfig = {
      ...rawPluginConfig,
      tokenFile: effectiveTokenFile,
    };

    const tokenFile = effectiveTokenFile;
    const pluginConfigTokens = readTokensFromConfigObject(
      effectivePluginConfig,
    );
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
          try {
            writeTokenFile(tokenFile, recoveredTokens);
            shouldClearLegacyTokens = true;
            api.logger.info(
              "membase: migrated legacy OAuth tokens to token file",
            );
          } catch (err) {
            shouldClearLegacyTokens = false;
            api.logger.warn(
              `membase: failed to persist migrated tokens; keeping plugin config unchanged: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          api.logger.warn(
            hasRedactedLegacyTokens
              ? "membase: legacy tokens are redacted and no recoverable token was found. Keeping existing plugin config; run 'openclaw membase login' once to repair."
              : "membase: no recoverable legacy tokens found during migration. Keeping existing plugin config unchanged.",
          );
        }
      }
    }

    const cfg = parseConfig(effectivePluginConfig, api.logger);
    if (shouldClearLegacyTokens) {
      // Chain onto the path-migration write (if any) to avoid a race condition
      // where both calls read openclaw.json before either has finished writing.
      (pathMigrationPromise ?? Promise.resolve())
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

    startBackgroundUpdateCheck();

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
    registerSearchWikiTool(api, client);
    registerAddWikiTool(api, client);
    registerUpdateWikiTool(api, client);
    registerDeleteWikiTool(api, client);

    if (cfg.autoRecall || cfg.autoWikiRecall) {
      registerRecallHook(api, client, cfg);
    }
    if (cfg.autoCapture) {
      registerCaptureHook(api, client, api.logger);
    }

    registerCli(api, client);

    ensureToolsAllowlist()
      .then((patched) => {
        if (patched) {
          api.logger.info(
            "membase: added plugin to tools.allow (restart gateway to activate tools)",
          );
        }
      })
      .catch(() => {});

    api.registerService({
      id: "openclaw-membase",
      start: () => {
        api.logger.info(
          `membase: connected (recall: ${cfg.autoRecall}, wikiRecall: ${cfg.autoWikiRecall}, capture: ${cfg.autoCapture})`,
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
