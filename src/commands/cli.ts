import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";

import type { MembaseClient } from "../client";
import {
  isInsideExtensionsDir,
  resolveDefaultTokenFilePath,
  resolveOpenClawConfigPath,
  resolveTokenFilePath,
  writeTokenFile,
} from "../config";
import {
  formatBundles,
  formatSearchProjectName,
  formatWikiCreateResult,
  formatWikiUpdateResult,
} from "../format";
import { maybePromptGithubStar } from "../star-prompt";
import type { OpenClawPluginApi } from "../types";
import { looksSensitive } from "../utils";

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

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : {};
}

function splitPositionalArgs(
  valueKey: string,
  positionalArg?: unknown,
  rawOpts?: unknown,
): { value: string; opts: JsonObject } {
  if (rawOpts !== undefined) {
    return {
      value: typeof positionalArg === "string" ? positionalArg : "",
      opts: asObject(rawOpts),
    };
  }
  if (typeof positionalArg === "string") {
    return { value: positionalArg, opts: {} };
  }
  const opts = asObject(positionalArg);
  const rawValue = opts[valueKey];
  return {
    value: typeof rawValue === "string" ? rawValue : "",
    opts,
  };
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

  let exitCode: number | null;
  if (typeof Bun !== "undefined") {
    const result = Bun.spawnSync({
      cmd: [opener, url],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    exitCode = result.exitCode;
  } else {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(opener, [url], { stdio: "ignore" });
    exitCode = result.status;
  }

  if (exitCode !== 0) {
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
  const configPath = resolveOpenClawConfigPath();
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

const PLUGIN_ID = "openclaw-membase";

export async function ensureToolsAllowlist(): Promise<boolean> {
  const configPath = resolveOpenClawConfigPath();

  let root: JsonObject = {};
  try {
    root = asObject(JSON.parse(await readFile(configPath, "utf-8")));
  } catch {
    return false;
  }

  const tools = asObject(root.tools);
  const profile = tools.profile;
  if (!profile || profile === "full") return false;

  const allow = Array.isArray(tools.allow) ? (tools.allow as string[]) : [];
  const alsoAllow = Array.isArray(tools.alsoAllow)
    ? [...(tools.alsoAllow as string[])]
    : [];

  const alreadyPresent =
    allow.includes(PLUGIN_ID) ||
    allow.includes("group:plugins") ||
    alsoAllow.includes(PLUGIN_ID) ||
    alsoAllow.includes("group:plugins");

  if (alreadyPresent) return false;

  // Use alsoAllow (additive) rather than allow (restrictive).
  // tools.allow with unknown plugin IDs is silently dropped by OpenClaw;
  // tools.alsoAllow appends on top of the active profile and is safe to
  // include before the plugin is fully loaded.
  alsoAllow.push(PLUGIN_ID);
  tools.alsoAllow = alsoAllow;
  root.tools = tools;

  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
  return true;
}

async function readCurrentPluginConfig(): Promise<JsonObject> {
  const configPath = resolveOpenClawConfigPath();
  try {
    const root = asObject(JSON.parse(await readFile(configPath, "utf-8")));
    const plugins = asObject(root.plugins);
    const entries = asObject(plugins.entries);
    const currentEntry = asObject(entries["openclaw-membase"]);
    return asObject(currentEntry.config);
  } catch {
    return {};
  }
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
    action: (
      handler: (...args: unknown[]) => Promise<void> | void,
    ) => CommandLike;
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

          const existingConfig = await readCurrentPluginConfig();
          let tokenFile = resolveTokenFilePath(existingConfig);
          if (isInsideExtensionsDir(tokenFile)) {
            tokenFile = resolveDefaultTokenFilePath();
          }
          writeTokenFile(tokenFile, {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? "",
          });

          await upsertPluginConfig({
            apiUrl,
            clientId,
            tokenFile,
            accessToken: "",
            refreshToken: "",
          });

          api.logger.info("OAuth login complete. Plugin config saved.");
          api.logger.info("Restart OpenClaw gateway to apply.");
          await maybePromptGithubStar().catch(() => {});
        });

      membase
        .command("search <query>")
        .description("Search memories by semantic similarity")
        .option("-l, --limit <limit>", "Max results", "10")
        .option(
          "-s, --sources <sources>",
          "Comma-separated source filter (e.g. slack,gmail)",
        )
        .action(async (queryArg?: unknown, rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const parsed = splitPositionalArgs("query", queryArg, rawOpts);
          const opts = parsed.opts as {
            query?: string;
            limit?: string;
            sources?: string;
          };
          const query = parsed.value || opts.query || "";
          const limit = Math.min(
            Number.parseInt(opts.limit ?? "10", 10) || 10,
            100,
          );
          const sources = opts.sources
            ? opts.sources
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
          try {
            const bundles = await client.search(
              query,
              limit,
              undefined,
              undefined,
              undefined,
              undefined,
              sources,
            );
            console.log(formatBundles(bundles));
          } catch (error) {
            api.logger.error(
              "Search failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("wiki-search <query>")
        .description("Search wiki documents")
        .option("-l, --limit <limit>", "Max results", "10")
        .option("--project <project>", "Optional Wiki filing location filter")
        .option(
          "-c, --collection <collection>",
          "Deprecated alias for --project",
        )
        .option(
          "--collection-id <collectionId>",
          "Optional wiki collection UUID filter",
        )
        .action(async (queryArg?: unknown, rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const parsed = splitPositionalArgs("query", queryArg, rawOpts);
          const opts = parsed.opts as {
            query?: string;
            limit?: string;
            project?: string;
            collection?: string;
            collectionId?: string;
          };
          const query = parsed.value || opts.query || "";
          const limit = Math.min(
            Number.parseInt(opts.limit ?? "10", 10) || 10,
            20,
          );
          try {
            const result = await client.searchWiki(query, limit, {
              project: opts.project,
              collection: opts.collection,
              collectionId: opts.collectionId,
            });
            if (result.documents.length === 0) {
              console.log("No wiki documents found.");
              return;
            }
            for (const [index, doc] of result.documents.entries()) {
              console.log(`${index + 1}. ${doc.title}`);
              console.log(`   ID: ${doc.id}`);
              console.log(
                `   Project: ${formatSearchProjectName(
                  doc.collection_id,
                  doc.collection_name,
                )}`,
              );
              if (doc.content) {
                console.log(`   ${doc.content}`);
              }
              console.log("");
            }
          } catch (error) {
            api.logger.error(
              "Wiki search failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("wiki-add <title>")
        .description("Add a wiki document")
        .option("--content <content>", "Full markdown content")
        .option("--project <project>", "Optional Wiki filing location")
        .option(
          "-c, --collection <collection>",
          "Deprecated alias for --project",
        )
        .action(async (titleArg?: unknown, rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const parsed = splitPositionalArgs("title", titleArg, rawOpts);
          const opts = parsed.opts as {
            title?: string;
            content?: string;
            project?: string;
            collection?: string;
          };
          const title = parsed.value || opts.title || "";
          if (!title.trim()) {
            api.logger.error("Missing wiki title.");
            return;
          }
          if (!opts.content?.trim()) {
            api.logger.error(
              'Missing --content. Example: openclaw membase wiki-add "Title" --content "# Doc"',
            );
            return;
          }
          if (looksSensitive(opts.content)) {
            api.logger.error(
              "Wiki add failed: content appears to contain secrets or private credentials. Redact it before saving.",
            );
            return;
          }
          try {
            const doc = await client.createWikiDocument(title, opts.content, {
              project: opts.project,
              collection: opts.collection,
            });
            api.logger.info(
              formatWikiCreateResult(doc, opts.project ?? opts.collection),
            );
          } catch (error) {
            api.logger.error(
              "Wiki add failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("wiki-update <docId>")
        .description("Update a wiki document")
        .option("--title <title>", "New title")
        .option("--content <content>", "Full replacement markdown content")
        .option("--project <project>", "Move to another Project by name")
        .option(
          "-c, --collection <collection>",
          "Deprecated alias for --project",
        )
        .option("--clear-project", "Move the document to Basic/default Project")
        .option("--clear-collection", "Deprecated alias for --clear-project")
        .action(async (docIdArg?: unknown, rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const parsed = splitPositionalArgs("docId", docIdArg, rawOpts);
          const opts = parsed.opts as {
            docId?: string;
            title?: string;
            content?: string;
            project?: string;
            collection?: string;
            clearProject?: boolean;
            clearCollection?: boolean;
          };
          const docId = parsed.value || opts.docId || "";
          if (!docId.trim()) {
            api.logger.error("Missing docId.");
            return;
          }
          if (
            opts.title === undefined &&
            opts.content === undefined &&
            opts.project === undefined &&
            opts.collection === undefined &&
            !opts.clearProject &&
            !opts.clearCollection
          ) {
            api.logger.error(
              "No updates supplied. Use --title, --content, --project, and/or --clear-project.",
            );
            return;
          }
          if (
            typeof opts.content === "string" &&
            looksSensitive(opts.content)
          ) {
            api.logger.error(
              "Wiki update failed: content appears to contain secrets or private credentials. Redact it before saving.",
            );
            return;
          }
          try {
            const clearProject = Boolean(
              opts.clearProject || opts.clearCollection,
            );
            const doc = await client.updateWikiDocument(docId, {
              title: opts.title,
              content: opts.content,
              project: clearProject ? null : opts.project,
              collection: opts.collection,
            });
            api.logger.info(
              formatWikiUpdateResult(
                doc,
                clearProject ? null : (opts.project ?? opts.collection),
              ),
            );
          } catch (error) {
            api.logger.error(
              "Wiki update failed:",
              error instanceof Error ? error.message : String(error),
            );
          }
        });

      membase
        .command("wiki-delete <docId>")
        .description("Delete a wiki document by ID")
        .action(async (docIdArg?: unknown, rawOpts?: unknown) => {
          if (!client.isAuthenticated()) {
            api.logger.warn(
              "Not logged in. Run 'openclaw membase login' first.",
            );
            return;
          }
          const parsed = splitPositionalArgs("docId", docIdArg, rawOpts);
          const opts = parsed.opts as { docId?: string };
          const docId = parsed.value || opts.docId || "";
          if (!docId.trim()) {
            api.logger.error("Missing docId.");
            return;
          }
          try {
            await client.deleteWikiDocument(docId);
            api.logger.info(`Wiki document deleted: ${docId}`);
          } catch (error) {
            api.logger.error(
              "Wiki delete failed:",
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
            const existingConfig = await readCurrentPluginConfig();
            let tokenFile = resolveTokenFilePath(existingConfig);
            if (isInsideExtensionsDir(tokenFile)) {
              tokenFile = resolveDefaultTokenFilePath();
            }
            writeTokenFile(tokenFile, {
              accessToken: "",
              refreshToken: "",
            });
            await upsertPluginConfig({
              tokenFile,
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
