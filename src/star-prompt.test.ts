import { describe, expect, test } from "bun:test";
import { maybePromptGithubStar } from "./star-prompt";

describe("maybePromptGithubStar", () => {
  test("marks prompted only after the question is shown", async () => {
    const steps: string[] = [];

    await maybePromptGithubStar({
      stdinIsTTY: true,
      stdoutIsTTY: true,
      hasBeenPromptedFn: async () => false,
      isGhInstalledFn: () => true,
      askYesNoFn: async () => {
        steps.push("ask");
        return false;
      },
      markPromptedFn: async () => {
        steps.push("mark");
      },
      starRepoFn: async () => {
        steps.push("star");
        return { ok: true };
      },
    });

    expect(steps).toEqual(["ask", "mark"]);
  });

  test("does not mark prompted when question fails", async () => {
    let marked = false;

    await expect(
      maybePromptGithubStar({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        hasBeenPromptedFn: async () => false,
        isGhInstalledFn: () => true,
        askYesNoFn: async () => {
          throw new Error("prompt failed");
        },
        markPromptedFn: async () => {
          marked = true;
        },
      }),
    ).rejects.toThrow("prompt failed");

    expect(marked).toBe(false);
  });

  test("continues star flow even if state write fails", async () => {
    const warnings: string[] = [];
    const logs: string[] = [];

    await maybePromptGithubStar({
      stdinIsTTY: true,
      stdoutIsTTY: true,
      hasBeenPromptedFn: async () => false,
      isGhInstalledFn: () => true,
      askYesNoFn: async () => true,
      markPromptedFn: async () => {
        throw new Error("disk error");
      },
      starRepoFn: async () => ({ ok: true }),
      warnFn: (message) => warnings.push(message),
      logFn: (message) => logs.push(message),
    });

    expect(
      warnings.some((message) => message.includes("persist star prompt state")),
    ).toBe(true);
    expect(logs).toContain("[membase] Thanks for the star!");
  });
});
