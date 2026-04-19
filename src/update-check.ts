/**
 * Ambient plugin update notifier.
 *
 * - Checks npm registry in the background once per boot.
 * - On the day's first successful tool response, appends a small footer with
 *   the new version. Subsequent responses that day are untouched.
 * - State is stored at ~/.membase/state/openclaw-update-check.json and shared
 *   across plugin restarts.
 *
 * Failure modes (network error, missing gh package, state disk error, etc.)
 * are all swallowed so the plugin's primary flow never breaks.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const PACKAGE_NAME = pkg.name;
const CURRENT_VERSION = pkg.version;
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(
  PACKAGE_NAME,
)}/latest`;
const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

interface UpdateCheckState {
  checked_at: string;
  current_version: string;
  latest_version: string | null;
  shown_at: string | null;
}

export function updateCheckStatePath(): string {
  return join(homedir(), ".membase", "state", "openclaw-update-check.json");
}

export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) =>
    (v.split("-")[0] ?? v).split(".").map((n) => {
      const parsed = Number.parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
  const r = parse(remote);
  const l = parse(local);
  const len = Math.max(r.length, l.length, 3);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function loadState(): Promise<UpdateCheckState | null> {
  const path = updateCheckStatePath();
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UpdateCheckState>;
    if (typeof parsed.checked_at !== "string") return null;
    return {
      checked_at: parsed.checked_at,
      current_version:
        typeof parsed.current_version === "string"
          ? parsed.current_version
          : CURRENT_VERSION,
      latest_version:
        typeof parsed.latest_version === "string"
          ? parsed.latest_version
          : null,
      shown_at: typeof parsed.shown_at === "string" ? parsed.shown_at : null,
    };
  } catch {
    return null;
  }
}

async function saveState(state: UpdateCheckState): Promise<void> {
  const path = updateCheckStatePath();
  const dir = join(homedir(), ".membase", "state");
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}

export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(REGISTRY_URL, {
      signal: ac.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isFreshCheck(checkedAt: string): boolean {
  const ts = Date.parse(checkedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function isSameUtcDay(
  lhs: string | null | undefined,
  rhs: Date = new Date(),
): boolean {
  if (!lhs) return false;
  const ts = Date.parse(lhs);
  if (!Number.isFinite(ts)) return false;
  const a = new Date(ts);
  return (
    a.getUTCFullYear() === rhs.getUTCFullYear() &&
    a.getUTCMonth() === rhs.getUTCMonth() &&
    a.getUTCDate() === rhs.getUTCDate()
  );
}

interface RefreshDeps {
  fetchImpl?: typeof fetch;
  loadStateFn?: typeof loadState;
  saveStateFn?: typeof saveState;
  currentVersion?: string;
  now?: () => Date;
}

export async function refreshLatestVersion(
  deps: RefreshDeps = {},
): Promise<void> {
  const load = deps.loadStateFn ?? loadState;
  const save = deps.saveStateFn ?? saveState;
  const fetchVersion = deps.fetchImpl
    ? () => fetchLatestVersion(deps.fetchImpl)
    : () => fetchLatestVersion();
  const current = deps.currentVersion ?? CURRENT_VERSION;
  const now = deps.now?.() ?? new Date();

  const existing = await load();
  if (
    existing?.checked_at &&
    existing.current_version === current &&
    isFreshCheck(existing.checked_at)
  ) {
    return;
  }

  const latest = await fetchVersion();
  if (!latest) return;

  await save({
    checked_at: now.toISOString(),
    current_version: current,
    latest_version: latest,
    shown_at:
      existing?.latest_version === latest ? (existing?.shown_at ?? null) : null,
  });
}

interface FooterDeps {
  loadStateFn?: typeof loadState;
  saveStateFn?: typeof saveState;
  currentVersion?: string;
  now?: () => Date;
}

/**
 * Returns the footer text to append (once per UTC day) or null.
 * Records `shown_at` on success so follow-up calls in the same day return null.
 */
export async function consumeUpdateFooter(
  deps: FooterDeps = {},
): Promise<string | null> {
  const load = deps.loadStateFn ?? loadState;
  const save = deps.saveStateFn ?? saveState;
  const current = deps.currentVersion ?? CURRENT_VERSION;
  const now = deps.now?.() ?? new Date();

  const state = await load();
  if (!state || !state.latest_version) return null;
  if (state.current_version !== current) return null;
  if (!isNewerVersion(state.latest_version, current)) return null;
  if (isSameUtcDay(state.shown_at, now)) return null;

  try {
    await save({ ...state, shown_at: now.toISOString() });
  } catch {
    // If we cannot persist, still show once — worst case the user sees the
    // footer again the next tool call until persistence succeeds.
  }

  return buildFooter(current, state.latest_version);
}

export function buildFooter(current: string, latest: string): string {
  return (
    "\n\n---\n" +
    `Membase plugin update available: ${current} → ${latest}\n` +
    `Run: openclaw plugins update ${PACKAGE_NAME}`
  );
}

/**
 * Appends the update footer to `text` at most once per UTC day.
 * Always returns the original text on any failure (never throws).
 */
export async function withUpdateFooter(
  text: string,
  deps: FooterDeps = {},
): Promise<string> {
  try {
    const footer = await consumeUpdateFooter(deps);
    return footer ? `${text}${footer}` : text;
  } catch {
    return text;
  }
}

/**
 * Fire-and-forget kickoff for plugin boot. Never throws, never blocks.
 */
export function startBackgroundUpdateCheck(): void {
  refreshLatestVersion().catch(() => {});
}

/**
 * Shared helper for membase_* tools: wraps a plain text response into the
 * MCP-style `{ content: [{ type, text }] }` shape and transparently appends
 * the update footer at most once per UTC day.
 */
export async function toolResponse(
  text: string,
  deps: FooterDeps = {},
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const withFooter = await withUpdateFooter(text, deps);
  return { content: [{ type: "text", text: withFooter }] };
}
