import type { MembasePluginConfig, OpenClawPluginApi } from "./types";

const DEFAULT_API_URL = "https://api.membase.so";

const KNOWN_KEYS = new Set([
	"apiUrl",
	"clientId",
	"accessToken",
	"refreshToken",
	"autoRecall",
	"autoCapture",
	"maxRecallChars",
	"debug",
]);

function str(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

export function parseConfig(
	pluginConfig: Record<string, unknown> = {},
	logger?: OpenClawPluginApi["logger"],
): MembasePluginConfig {
	const unknownKeys = Object.keys(pluginConfig).filter(
		(k) => !KNOWN_KEYS.has(k),
	);
	if (unknownKeys.length > 0 && logger) {
		logger.warn(
			`membase: unknown config keys ignored: ${unknownKeys.join(", ")}`,
		);
	}

	return {
		apiUrl:
			str(pluginConfig.apiUrl, "") ||
			process.env.MEMBASE_API_URL ||
			DEFAULT_API_URL,
		clientId: str(pluginConfig.clientId, ""),
		accessToken: str(pluginConfig.accessToken, ""),
		refreshToken: str(pluginConfig.refreshToken, ""),
		autoRecall: (pluginConfig.autoRecall as boolean) ?? true,
		autoCapture: (pluginConfig.autoCapture as boolean) ?? true,
		maxRecallChars: Math.max(
			500,
			Math.min((pluginConfig.maxRecallChars as number) ?? 4000, 16000),
		),
		debug: (pluginConfig.debug as boolean) ?? false,
	};
}
