/**
 * One-time GitHub star prompt after login (same pattern as membase-cli star-prompt).
 * Skipped when no TTY or when gh CLI is not installed.
 * State stored in ~/.membase/state/star-prompt.json so it shows once per user
 * and is shared with membase-cli (avoids prompting twice).
 */

import * as childProcess from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const REPO = "aristoapp/openclaw-membase";
const GH_CHECK_TIMEOUT_MS = 3000;
const STAR_TIMEOUT_MS = 30000;

interface StarPromptState {
  prompted_at: string;
}

export function starPromptStatePath(): string {
  return join(homedir(), ".membase", "state", "star-prompt.json");
}

export async function hasBeenPrompted(): Promise<boolean> {
  const path = starPromptStatePath();
  if (!existsSync(path)) return false;
  try {
    const content = await readFile(path, "utf-8");
    const state = JSON.parse(content) as StarPromptState;
    return typeof state.prompted_at === "string";
  } catch {
    return false;
  }
}

export async function markPrompted(): Promise<void> {
  const stateDir = join(homedir(), ".membase", "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    starPromptStatePath(),
    JSON.stringify({ prompted_at: new Date().toISOString() }, null, 2),
  );
}

export function isGhInstalled(): boolean {
  const result = childProcess.spawnSync("gh", ["--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: GH_CHECK_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  return !result.error && result.status === 0;
}

export function isGhAuthenticated(): boolean {
  const result = childProcess.spawnSync("gh", ["auth", "status"], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: GH_CHECK_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  return !result.error && result.status === 0;
}

export type StarRepoResult = { ok: true } | { ok: false; error: string };

interface MaybePromptGithubStarDeps {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  hasBeenPromptedFn?: () => Promise<boolean>;
  isGhInstalledFn?: () => boolean;
  isGhAuthenticatedFn?: () => boolean;
  markPromptedFn?: () => Promise<void>;
  askYesNoFn?: (question: string) => Promise<boolean>;
  starRepoFn?: () => Promise<StarRepoResult>;
  logFn?: (message: string) => void;
  warnFn?: (message: string) => void;
}

export function starRepo(): Promise<StarRepoResult> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), STAR_TIMEOUT_MS);

    execFile(
      "gh",
      ["api", "-X", "PUT", `/user/starred/${REPO}`],
      {
        encoding: "utf-8",
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
        signal: ac.signal,
      },
      (error, _stdout, stderr) => {
        clearTimeout(timer);
        if (error) {
          if (
            error.name === "AbortError" ||
            (error as NodeJS.ErrnoException).code === "ABORT_ERR"
          ) {
            resolve({
              ok: false,
              error: `gh timed out after ${Math.floor(STAR_TIMEOUT_MS / 1000)}s`,
            });
            return;
          }
          resolve({ ok: false, error: stderr?.trim() || error.message });
          return;
        }
        resolve({ ok: true });
      },
    );
  });
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function maybePromptGithubStar(
  deps: MaybePromptGithubStarDeps = {},
): Promise<void> {
  const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
  const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
  if (!stdinIsTTY || !stdoutIsTTY) return;

  const hasBeenPromptedImpl = deps.hasBeenPromptedFn ?? hasBeenPrompted;
  if (await hasBeenPromptedImpl()) return;

  const isGhInstalledImpl = deps.isGhInstalledFn ?? isGhInstalled;
  if (!isGhInstalledImpl()) return;

  const isGhAuthenticatedImpl = deps.isGhAuthenticatedFn ?? isGhAuthenticated;
  if (!isGhAuthenticatedImpl()) return;

  const askYesNoImpl = deps.askYesNoFn ?? askYesNo;
  const approved = await askYesNoImpl(
    "[membase] Enjoying Membase? Star it on GitHub? [Y/n] ",
  );

  const warn =
    deps.warnFn ??
    ((message: string) => {
      process.stderr.write(`${message}\n`);
    });
  const markPromptedImpl = deps.markPromptedFn ?? markPrompted;
  try {
    await markPromptedImpl();
  } catch (error) {
    warn(
      `[membase] Could not persist star prompt state: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!approved) return;

  const starRepoImpl = deps.starRepoFn ?? starRepo;
  const star = await starRepoImpl();
  if (star.ok) {
    const log =
      deps.logFn ??
      ((message: string) => {
        process.stdout.write(`${message}\n`);
      });
    log("[membase] Thanks for the star!");
    return;
  }
  warn(`[membase] Could not star repository automatically: ${star.error}`);
}
