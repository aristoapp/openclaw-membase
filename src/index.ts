import { MembaseClient } from "./client";
import { registerCli, upsertPluginConfig } from "./commands/cli";
import { parseConfig, readTokenFile, writeTokenFile } from "./config";
import { flushAllBuffers, registerCaptureHook } from "./hooks/capture";
import { registerRecallHook } from "./hooks/recall";
import { registerForgetTool } from "./tools/forget";
import { registerProfileTool } from "./tools/profile";
import { registerSearchTool } from "./tools/search";
import { registerStoreTool } from "./tools/store";
import type { OpenClawPluginApi } from "./types";

export default {
  id: "openclaw-membase",
  name: "Membase",
  description: "OpenClaw memory plugin backed by Membase",
  kind: "memory" as const,

  register(api: OpenClawPluginApi) {
    const rawPluginConfig = api.pluginConfig ?? {};
    const cfg = parseConfig(rawPluginConfig, api.logger);

    const legacyAccessToken =
      typeof rawPluginConfig.accessToken === "string"
        ? rawPluginConfig.accessToken
        : "";
    const legacyRefreshToken =
      typeof rawPluginConfig.refreshToken === "string"
        ? rawPluginConfig.refreshToken
        : "";
    const hasLegacyTokens = Boolean(legacyAccessToken || legacyRefreshToken);

    if (hasLegacyTokens) {
      const existingTokenFilePair = readTokenFile(cfg.tokenFile, api.logger);
      const hasTokenFileValues = Boolean(
        existingTokenFilePair.accessToken || existingTokenFilePair.refreshToken,
      );

      Promise.resolve()
        .then(() => {
          if (!hasTokenFileValues) {
            writeTokenFile(cfg.tokenFile, {
              accessToken: legacyAccessToken,
              refreshToken: legacyRefreshToken,
            });
          }
          return upsertPluginConfig({
            apiUrl: cfg.apiUrl,
            clientId: cfg.clientId,
            tokenFile: cfg.tokenFile,
            accessToken: "",
            refreshToken: "",
          });
        })
        .then(() => {
          api.logger.info(
            "membase: migrated legacy OAuth tokens to token file",
          );
        })
        .catch((err) =>
          api.logger.error(
            "membase: failed to migrate legacy OAuth tokens",
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
        "membase: missing OAuth tokens. Run 'openclaw membase login'.",
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
