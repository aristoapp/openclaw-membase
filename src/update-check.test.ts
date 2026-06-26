import { describe, expect, test } from "bun:test";
import {
  consumeUpdateFooter,
  isNewerVersion,
  refreshLatestVersion,
  withUpdateFooter,
} from "./update-check";

describe("isNewerVersion", () => {
  test("detects patch/minor/major bumps", () => {
    expect(isNewerVersion("0.4.3", "0.4.2")).toBe(true);
    expect(isNewerVersion("0.5.0", "0.4.2")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.4.2")).toBe(true);
  });

  test("returns false for equal or older", () => {
    expect(isNewerVersion("0.4.2", "0.4.2")).toBe(false);
    expect(isNewerVersion("0.4.1", "0.4.2")).toBe(false);
    expect(isNewerVersion("0.3.9", "0.4.0")).toBe(false);
  });

  test("ignores prerelease suffix", () => {
    expect(isNewerVersion("0.5.0-beta.1", "0.4.2")).toBe(true);
    expect(isNewerVersion("0.4.2-rc.1", "0.4.2")).toBe(false);
  });
});

describe("consumeUpdateFooter", () => {
  const today = new Date("2026-04-19T12:00:00Z");

  test("returns null when no cached state", async () => {
    const result = await consumeUpdateFooter({
      loadStateFn: async () => null,
      saveStateFn: async () => {},
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(result).toBeNull();
  });

  test("returns null when remote is not newer", async () => {
    const result = await consumeUpdateFooter({
      loadStateFn: async () => ({
        checked_at: today.toISOString(),
        current_version: "0.4.2",
        latest_version: "0.4.2",
        shown_at: null,
      }),
      saveStateFn: async () => {},
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(result).toBeNull();
  });

  test("returns footer and marks shown on first call of day", async () => {
    let saved: unknown = null;
    const result = await consumeUpdateFooter({
      loadStateFn: async () => ({
        checked_at: today.toISOString(),
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: null,
      }),
      saveStateFn: async (state) => {
        saved = state;
      },
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(result).toContain("0.4.2 → 0.5.0");
    expect((saved as { shown_at: string }).shown_at).toBe(today.toISOString());
  });

  test("returns null when already shown today", async () => {
    const result = await consumeUpdateFooter({
      loadStateFn: async () => ({
        checked_at: today.toISOString(),
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: "2026-04-19T02:00:00Z",
      }),
      saveStateFn: async () => {},
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(result).toBeNull();
  });

  test("shows again on a new UTC day", async () => {
    const tomorrow = new Date("2026-04-20T00:05:00Z");
    const result = await consumeUpdateFooter({
      loadStateFn: async () => ({
        checked_at: "2026-04-19T12:00:00Z",
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: "2026-04-19T12:00:00Z",
      }),
      saveStateFn: async () => {},
      currentVersion: "0.4.2",
      now: () => tomorrow,
    });
    expect(result).toContain("0.4.2 → 0.5.0");
  });

  test("returns null when state was written for an older local version", async () => {
    const result = await consumeUpdateFooter({
      loadStateFn: async () => ({
        checked_at: today.toISOString(),
        current_version: "0.4.1",
        latest_version: "0.4.2",
        shown_at: null,
      }),
      saveStateFn: async () => {},
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(result).toBeNull();
  });
});

describe("withUpdateFooter", () => {
  test("returns original text on failure", async () => {
    const result = await withUpdateFooter("hello", {
      loadStateFn: async () => {
        throw new Error("disk boom");
      },
      currentVersion: "0.4.2",
      now: () => new Date("2026-04-19T12:00:00Z"),
    });
    expect(result).toBe("hello");
  });

  test("appends footer once when update is available", async () => {
    let call = 0;
    const deps = {
      loadStateFn: async () => ({
        checked_at: "2026-04-19T12:00:00Z",
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: call === 0 ? null : "2026-04-19T12:00:00Z",
      }),
      saveStateFn: async () => {
        call++;
      },
      currentVersion: "0.4.2",
      now: () => new Date("2026-04-19T12:00:00Z"),
    };

    const first = await withUpdateFooter("result A", deps);
    const second = await withUpdateFooter("result B", deps);

    expect(first).toContain("result A");
    expect(first).toContain("0.4.2 → 0.5.0");
    expect(second).toBe("result B");
  });
});

describe("refreshLatestVersion", () => {
  const today = new Date("2026-04-19T12:00:00Z");

  test("skips fetch when cache is fresh", async () => {
    let fetched = false;
    await refreshLatestVersion({
      loadStateFn: async () => ({
        checked_at: new Date(Date.now() - 60_000).toISOString(),
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: null,
      }),
      saveStateFn: async () => {},
      fetchImpl: (async () => {
        fetched = true;
        return new Response(JSON.stringify({ version: "0.5.0" }));
      }) as unknown as typeof fetch,
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(fetched).toBe(false);
  });

  test("fetches and persists when cache is stale", async () => {
    const saved: Array<{ latest_version: string | null }> = [];
    await refreshLatestVersion({
      loadStateFn: async () => null,
      saveStateFn: async (state) => {
        saved.push(state as { latest_version: string | null });
      },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ version: "0.5.0" }),
        )) as unknown as typeof fetch,
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(saved[0]?.latest_version).toBe("0.5.0");
  });

  test("clears shown_at when latest_version changes", async () => {
    const saved: Array<{ shown_at: string | null }> = [];
    await refreshLatestVersion({
      loadStateFn: async () => ({
        checked_at: new Date(
          today.getTime() - 1000 * 60 * 60 * 48,
        ).toISOString(),
        current_version: "0.4.2",
        latest_version: "0.5.0",
        shown_at: "2026-04-18T12:00:00Z",
      }),
      saveStateFn: async (state) => {
        saved.push(state as { shown_at: string | null });
      },
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ version: "0.6.0" }),
        )) as unknown as typeof fetch,
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(saved[0]).toBeDefined();
    expect(saved[0]?.shown_at).toBeNull();
  });

  test("does nothing on registry failure", async () => {
    let saved = false;
    await refreshLatestVersion({
      loadStateFn: async () => null,
      saveStateFn: async () => {
        saved = true;
      },
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      currentVersion: "0.4.2",
      now: () => today,
    });
    expect(saved).toBe(false);
  });
});
