import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { MembaseClient } from "../client";
import { formatBundles } from "../format";
import type { OpenClawPluginApi } from "../types";

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
};

type JsonObject = Record<string, unknown>;

function b64url(input: Uint8Array): string {
  return btoa(Array.from(input, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getOpenClawConfigPath(): string {
  return join(homedir(), ".openclaw", "openclaw.json");
}

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : {};
}

async function openAuthUrl(
  url: string,
  logger: OpenClawPluginApi["logger"],
): Promise<void> {
  const platform = process.platform;
  const opener =
    platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;

  if (!opener) {
    logger.info("Open this URL manually:");
    logger.info(url);
    return;
  }

  const result = spawnSync(opener, [url], {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    logger.info(
      "Could not open browser automatically. Open this URL manually:",
    );
    logger.info(url);
  }
}

type OAuthCallbackListener = {
  port: number;
  waitForCode: Promise<{ code: string }>;
  close: () => void;
};

async function startOAuthCallbackListener(
  preferredPort: number,
  expectedState: string,
  timeoutMs = 180_000,
  maxPortAttempts = 20,
): Promise<OAuthCallbackListener> {
  const server = createServer();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (!server.listening) return;
    server.close();
  };

  const waitForCode = new Promise<{ code: string }>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    timeout = setTimeout(() => {
      timedOut = true;
      settle(() => {
        close();
        reject(new Error("OAuth callback timed out"));
      });
    }, timeoutMs);

    server.on("request", (req, res) => {
      try {
        if (timedOut) {
          res.statusCode = 408;
          res.end("Timed out");
          return;
        }
        const addr = server.address();
        const port =
          addr && typeof addr !== "string" ? addr.port : preferredPort;
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/oauth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          settle(() => {
            if (timeout) clearTimeout(timeout);
            close();
            reject(new Error(`OAuth authorization failed: ${error}`));
          });
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            "<h3>Authorization failed.</h3><p>You can close this tab.</p>",
          );
          return;
        }

        if (!code || !state) {
          settle(() => {
            if (timeout) clearTimeout(timeout);
            close();
            reject(new Error("Missing OAuth code or state parameter"));
          });
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            "<h3>Missing OAuth code/state.</h3><p>You can close this tab.</p>",
          );
          return;
        }

        if (state !== expectedState) {
          settle(() => {
            if (timeout) clearTimeout(timeout);
            close();
            reject(new Error("OAuth state mismatch"));
          });
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            "<h3>Invalid OAuth state.</h3><p>You can close this tab.</p>",
          );
          return;
        }

        settle(() => {
          if (timeout) clearTimeout(timeout);
          close();
          resolve({ code });
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<h3>Membase connected.</h3><p>You can close this tab and return to OpenClaw.</p>",
        );
      } catch (error) {
        settle(() => {
          if (timeout) clearTimeout(timeout);
          close();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        res.statusCode = 500;
        res.end("Server error");
      }
    });
  });

  const boundPort = await new Promise<number>((resolve, reject) => {
    const tryListen = (port: number, attemptsLeft: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
          tryListen(port + 1, attemptsLeft - 1);
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to get callback server address"));
          return;
        }
        resolve(address.port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };

    tryListen(preferredPort, maxPortAttempts);
  });

  return {
    port: boundPort,
    waitForCode,
    close,
  };
}

export async function upsertPluginConfig(
  nextConfig: JsonObject,
): Promise<void> {
  const configPath = getOpenClawConfigPath();
  const configDir = dirname(configPath);
  await mkdir(configDir, { recursive: true });

  let root: JsonObject = {};
  try {
    root = asObject(JSON.parse(await readFile(configPath, "utf-8")));
  } catch {
    root = {};
  }

  const plugins = asObject(root.plugins);
  const entries = asObject(plugins.entries);
  const currentEntry = asObject(entries["openclaw-membase"]);
  const currentConfig = asObject(currentEntry.config);

  entries["openclaw-membase"] = {
    ...currentEntry,
    enabled: true,
    config: {
      ...currentConfig,
      ...nextConfig,
    },
  };
  plugins.entries = entries;
  root.plugins = plugins;

  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
}

async function createPkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = b64url(new Uint8Array(digest));
  return { verifier, challenge };
}

async function dynamicRegisterClient(apiUrl: string, redirectUri: string) {
  const response = await fetch(`${apiUrl}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Membase OpenClaw",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "memory:read memory:write offline_access",
    }),
  });
  if (!response.ok) {
    throw new Error(`OAuth client registration failed (${response.status})`);
  }
  const data = (await response.json()) as { client_id: string };
  if (!data.client_id) {
    throw new Error("OAuth registration returned no client_id");
  }
  return data.client_id;
}

async function exchangeCodeForToken(
  apiUrl: string,
  code: string,
  clientId: string,
  redirectUri: string,
  verifier: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(`${apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OAuth token exchange failed (${response.status}): ${text}`,
    );
  }
  return (await response.json()) as OAuthTokenResponse;
}

export function registerCli(api: OpenClawPluginApi, client: MembaseClient) {
  type CommandLike = {
    description: (text: string) => CommandLike;
    command: (name: string) => CommandLike;
    option: (flags: string, desc: string, defaultValue?: string) => CommandLike;
    action: (handler: (opts?: unknown) => Promise<void> | void) => CommandLike;
  };

  type ProgramLike = {
    command: (name: string) => CommandLike;
  };

  api.registerCli(
    ({ program }: { program: ProgramLike }) => {
      const membase = program
        .command("membase")
        .description("Membase commands");

      membase
        .command("login")
        .description("Login with OAuth (PKCE) and save plugin config")
        .option("--api-url <url>", "Membase API URL", "https://api.membase.so")
        .option("--port <port>", "OAuth callback port", "8765")
        .action(async (rawOpts?: unknown) => {
          const opts = (rawOpts ?? {}) as {
            apiUrl?: string;
            port?: string;
          };
          const apiUrl = (opts.apiUrl ?? "https://api.membase.so").replace(
            /\/$/,
            "",
          );
          const { verifier, challenge } = await createPkce();
          const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
          const preferredPort =
            Number.parseInt(opts.port ?? "8765", 10) || 8765;

          api.logger.info("Starting local OAuth callback listener...");
          const callbackListener = await startOAuthCallbackListener(
            preferredPort,
            state,
          );
          const redirectUri = `http://127.0.0.1:${callbackListener.port}/oauth/callback`;

          const clientId = await dynamicRegisterClient(apiUrl, redirectUri);
          const authUrl = new URL(`${apiUrl}/oauth/authorize`);
          authUrl.searchParams.set("response_type", "code");
          authUrl.searchParams.set("client_id", clientId);
          authUrl.searchParams.set("redirect_uri", redirectUri);
          authUrl.searchParams.set(
            "scope",
            "memory:read memory:write offline_access",
          );
          authUrl.searchParams.set("state", state);
          authUrl.searchParams.set("code_challenge", challenge);
          authUrl.searchParams.set("code_challenge_method", "S256");

          await openAuthUrl(authUrl.toString(), api.logger);
          api.logger.info("Waiting for browser authorization...");
          api.logger.info(
            `(If browser didn't open, visit: ${authUrl.toString()})`,
          );
          if (callbackListener.port !== preferredPort) {
            api.logger.warn(
              `Port ${preferredPort} in use. Using callback port ${callbackListener.port}.`,
            );
          }

          const { code } = await callbackListener.waitForCode;

          const tokens = await exchangeCodeForToken(
            apiUrl,
            code,
            clientId,
            redirectUri,
            verifier,
          );

          await upsertPluginConfig({
            apiUrl,
            clientId,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? "",
          });

          api.logger.info("OAuth login complete. Plugin config saved.");
          api.logger.info("Restart OpenClaw gateway to apply.");
        });

      membase
        .command("search <query>")
        .description("Search memories by semantic similarity")
        .option("-l, --limit <limit>", "Max results", "10")
        .action(async (rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const opts = (rawOpts ?? {}) as {
            query?: string;
            limit?: string;
          };
          const query =
            typeof rawOpts === "string" ? rawOpts : (opts.query ?? "");
          const limit = Math.min(
            Number.parseInt(opts.limit ?? "10", 10) || 10,
            100,
          );
          try {
            const bundles = await client.search(query, limit);
            console.log(formatBundles(bundles));
          } catch (error) {
            api.logger.error(
              "Search failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("status")
        .description("Check Membase API connectivity")
        .action(async () => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          try {
            await client.getProfile();
            api.logger.info("Membase connection: OK");
          } catch (error) {
            api.logger.error(
              "Membase connection failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("logout")
        .description("Remove stored OAuth tokens and disconnect")
        .action(async () => {
          try {
            await upsertPluginConfig({
              accessToken: "",
              refreshToken: "",
              clientId: "",
            });
            api.logger.info(
              "Membase tokens removed. Restart OpenClaw to apply.",
            );
          } catch (error) {
            api.logger.error(
              "Logout failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
    },
    { commands: ["membase"] },
  );
}
