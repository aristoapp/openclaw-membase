import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MembasePluginConfig, OpenClawPluginApi } from "./types";

const DEFAULT_API_URL = "https://api.membase.so";
export const REDACTED_TOKEN_SENTINEL = "__OPENCLAW_REDACTED__";

// Safe persistent location — outside extensions/ which is wiped on plugin update.
export const DEFAULT_TOKEN_FILE_PATH = join(
  homedir(),
  ".openclaw",
  "credentials",
  "openclaw-membase.json",
);

// Returns true if a path is inside extensions/ — that directory is fully replaced
// whenever openclaw plugins update/reinstall, so token files stored there will be lost.
export function isInsideExtensionsDir(tokenFile: string): boolean {
  const normalized = tokenFile.split("\\").join("/");
  const extensionsMarker = "/.openclaw/extensions/";
  return normalized.includes(extensionsMarker);
}

const KNOWN_KEYS = new Set([
  "apiUrl",
  "clientId",
  "tokenFile",
  "accessToken",
  "refreshToken",
  "autoRecall",
  "autoCapture",
  "maxRecallChars",
  "debug",
]);

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function isRedactedTokenValue(value: unknown): boolean {
  return typeof value === "string" && value === REDACTED_TOKEN_SENTINEL;
}

function normalizeTokenValue(value: unknown): string {
  if (isRedactedTokenValue(value)) {
    return "";
  }
  return str(value, "");
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function asTokenPair(value: unknown): TokenPair {
  if (!value || typeof value !== "object") {
    return { accessToken: "", refreshToken: "" };
  }

  const obj = value as Record<string, unknown>;
  return {
    accessToken: normalizeTokenValue(obj.accessToken),
    refreshToken: normalizeTokenValue(obj.refreshToken),
  };
}

export function resolveTokenFilePath(
  pluginConfig: Record<string, unknown> = {},
): string {
  const configured = str(pluginConfig.tokenFile, "");
  return expandHomePath(configured || DEFAULT_TOKEN_FILE_PATH);
}

export function readTokenFile(
  tokenFile: string,
  logger?: OpenClawPluginApi["logger"],
): TokenPair {
  try {
    const raw = readFileSync(tokenFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      logger &&
      parsed &&
      typeof parsed === "object" &&
      (isRedactedTokenValue((parsed as Record<string, unknown>).accessToken) ||
        isRedactedTokenValue((parsed as Record<string, unknown>).refreshToken))
    ) {
      logger.warn(
        "membase: redacted token marker found in token file; treating as missing tokens",
      );
    }
    return asTokenPair(parsed);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return { accessToken: "", refreshToken: "" };
    }
    if (logger) {
      logger.warn(
        `membase: failed to read token file at ${tokenFile}; falling back to plugin config`,
      );
    }
    return { accessToken: "", refreshToken: "" };
  }
}

export function writeTokenFile(tokenFile: string, tokens: TokenPair): void {
  const dir = dirname(tokenFile);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${tokenFile}.tmp`;
  const payload = JSON.stringify(
    {
      accessToken: str(tokens.accessToken, ""),
      refreshToken: str(tokens.refreshToken, ""),
    },
    null,
    2,
  );
  writeFileSync(tempPath, `${payload}\n`, "utf-8");
  renameSync(tempPath, tokenFile);
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

  const tokenFile = resolveTokenFilePath(pluginConfig);
  const fileTokens = readTokenFile(tokenFile, logger);

  return {
    apiUrl:
      str(pluginConfig.apiUrl, "") ||
      process.env.MEMBASE_API_URL ||
      DEFAULT_API_URL,
    clientId: str(pluginConfig.clientId, ""),
    tokenFile,
    accessToken:
      fileTokens.accessToken || normalizeTokenValue(pluginConfig.accessToken),
    refreshToken:
      fileTokens.refreshToken || normalizeTokenValue(pluginConfig.refreshToken),
    autoRecall: (pluginConfig.autoRecall as boolean) ?? true,
    autoCapture: (pluginConfig.autoCapture as boolean) ?? true,
    maxRecallChars: Math.max(
      500,
      Math.min((pluginConfig.maxRecallChars as number) ?? 4000, 16000),
    ),
    debug: (pluginConfig.debug as boolean) ?? false,
  };
}
