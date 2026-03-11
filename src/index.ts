import { MembaseClient } from "./client";
import { registerCli, upsertPluginConfig } from "./commands/cli";
import { parseConfig } from "./config";
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
		const cfg = parseConfig(api.pluginConfig ?? {}, api.logger);

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
					upsertPluginConfig({
						apiUrl: cfg.apiUrl,
						clientId: cfg.clientId,
						accessToken: tokens.accessToken,
						refreshToken: tokens.refreshToken,
					}).catch((err) =>
						api.logger.error(
							"membase: failed to persist refreshed tokens",
							err,
						),
					);
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
