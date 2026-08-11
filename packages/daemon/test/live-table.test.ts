import { describe, expect, it } from "vitest";
import { buildLiveTable, deriveStatus, liveTableSchema, shortCwd } from "../src/live-table.js";

describe("live table", () => {
  it("sorts by lastSeenAt desc", () => {
    const t = buildLiveTable({
      sessions: [
        {
          liveSessionId: "a",
          agent: "claude",
          cwd: "/a/b",
          lastSeenAt: "2026-08-11T00:00:00.000Z",
        },
        { liveSessionId: "b", agent: "codex", cwd: "/a/c", lastSeenAt: "2026-08-11T00:01:00.000Z" },
      ],
      statsBurn: new Map(),
      now: () => Date.parse("2026-08-11T00:02:00.000Z"),
    });
    expect(t.sessions[0]?.liveSessionId).toBe("b");
  });

  it("derives blocked", () => {
    expect(
      deriveStatus({
        lastSeenAt: "2026-08-11T00:00:00.000Z",
        lastHookEvent: "blocked",
        now: Date.parse("2026-08-11T00:02:30.000Z"),
      }),
    ).toBe("blocked");
  });

  it("shortCwd", () => {
    expect(shortCwd("/a/b/c/d")).toBe("c/d");
    expect(shortCwd("/a")).toBe("a");
  });

  it("strict rejects extra", () => {
    expect(() => liveTableSchema.parse({ x: 1 })).toThrow();
  });

  it("burn null → n/a handling and claim count", () => {
    const t = buildLiveTable({
      sessions: [
        {
          liveSessionId: "a",
          agent: "claude",
          cwd: "/x/y/z",
          lastSeenAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      statsBurn: new Map([["a", null]]),
      claimCounts: new Map([["a", 2]]),
      now: () => Date.parse("2026-08-11T00:01:00.000Z"),
    });
    expect(t.sessions[0]?.burn).toBeNull();
    expect(t.sessions[0]?.claimWarnings).toBe(2);
  });

  it("deriveStatus working and done", () => {
    // working: heartbeat <60s
    expect(
      deriveStatus({
        lastSeenAt: "2026-08-11T00:01:30.000Z",
        now: Date.parse("2026-08-11T00:02:00.000Z"),
      }),
    ).toBe("working");
    // done: >5m
    expect(
      deriveStatus({
        lastSeenAt: "2026-08-11T00:00:00.000Z",
        now: Date.parse("2026-08-11T00:06:00.000Z"),
      }),
    ).toBe("done");
  });
});
