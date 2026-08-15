import { describe, expect, it } from "vitest";
import { detectSilentFailures } from "../../src/commands/failures/detectors.js";
import type { FailureSnapshot } from "../../src/commands/failures/snapshot.js";

const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");
const ALL_ON = {
  "tool-error": true,
  "context-overflow": true,
  "partial-completion": true,
  "hallucinated-state": true,
} as const;

let seq = 0;
function ev(over: Record<string, unknown>) {
  return {
    id: `evt-${seq++}`,
    liveSessionId: "sess-a",
    workspaceKey: "wk-a",
    createdAt: "2026-08-06T11:30:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    ...over,
  } as never;
}

function snap(over: Partial<FailureSnapshot> = {}): FailureSnapshot {
  return {
    workspaceKey: "wk-a",
    liveSessionId: "sess-a",
    events: [],
    chunkSets: [],
    readIndex: undefined,
    capsule: undefined,
    refs: undefined,
    ...over,
  };
}

function run(s: FailureSnapshot, over: Record<string, unknown> = {}) {
  const results = detectSilentFailures(s, {
    windowMinutes: 240,
    nowMs: NOW_MS,
    cwd: "/work/demo",
    enabled: ALL_ON,
    fileExists: () => false,
    redactText: (raw) => raw,
    ...over,
  });
  return Object.fromEntries(results.map((r) => [r.id, r]));
}

describe("tool-error", () => {
  it("null exit counts as failing; absent childExitCode rows are excluded", () => {
    const byId = run(
      snap({ events: [ev({ childExitCode: null }), ev({ label: "pre-gate row" })] }),
    );
    expect(byId["tool-error"]?.verdict).toBe("findings");
    expect(byId["tool-error"]?.findings).toHaveLength(1);
  });

  it("zero recorded receipts → no-signal, never a guess", () => {
    const byId = run(snap({ events: [ev({})] })); // no childExitCode anywhere
    expect(byId["tool-error"]?.verdict).toBe("no-signal");
    expect(byId["tool-error"]?.reason).toContain("no exec receipts");
  });

  it("out-of-window failures do not fire", () => {
    const byId = run(
      snap({ events: [ev({ childExitCode: 2, createdAt: "2026-08-06T07:00:00.000Z" })] }),
    );
    expect(byId["tool-error"]?.verdict).toBe("no-signal");
  });
});

describe("partial-completion", () => {
  it("a later expansion row carrying the chunkSetId resolves the failure", () => {
    const byId = run(
      snap({
        events: [
          ev({ childExitCode: 2, chunkSetId: "cs-dead", createdAt: "2026-08-06T11:00:00.000Z" }),
          ev({ kind: "expansion", chunkSetId: "cs-dead", createdAt: "2026-08-06T11:10:00.000Z" }),
        ],
      }),
    );
    expect(byId["partial-completion"]?.verdict).toBe("clear");
  });

  it("a later zero-exit receipt resolves; an unresolved failure is a candidate finding", () => {
    const resolved = run(
      snap({
        events: [
          ev({ childExitCode: 2, createdAt: "2026-08-06T11:00:00.000Z" }),
          ev({ childExitCode: 0, createdAt: "2026-08-06T11:20:00.000Z" }),
        ],
      }),
    );
    expect(resolved["partial-completion"]?.verdict).toBe("clear");
    const unresolved = run(snap({ events: [ev({ childExitCode: 2 })] }));
    expect(unresolved["partial-completion"]?.verdict).toBe("findings");
    expect(unresolved["partial-completion"]?.findings[0]).toContain(
      "unacknowledged-failure candidate",
    );
  });
});

describe("context-overflow", () => {
  it("no input → no-signal; dangling chunk ref → finding; resolving ref → clear", () => {
    const none = run(snap());
    expect(none["context-overflow"]?.verdict).toBe("no-signal");
    const dangling = run(snap({ refs: { chunkRefs: ["cs-aaaaaaaaaaaa"], pathRefs: [] } }));
    expect(dangling["context-overflow"]?.verdict).toBe("findings");
    // v1: known ids come from events only (chunkSets is the compaction-guard
    // hardcode [] — spec Decision 8 amendment)
    const resolved = run(
      snap({
        refs: { chunkRefs: ["cs-aaaaaaaaaaaa"], pathRefs: [] },
        events: [ev({ chunkSetId: "cs-aaaaaaaaaaaa" })],
      }),
    );
    expect(resolved["context-overflow"]?.verdict).toBe("clear");
  });
});

describe("hallucinated-state", () => {
  const refs = {
    chunkRefs: [],
    pathRefs: ["src/ghost.ts", "src/written.ts", "/etc/passwd"],
  } as const;

  it("phantom vs exists-uncaptured vs outside-workspace", () => {
    const byId = run(snap({ refs, readIndex: {} }), {
      fileExists: (abs: string) => abs.endsWith("written.ts"), // platform-neutral: win32 paths use backslashes
    });
    const hs = byId["hallucinated-state"];
    expect(hs?.verdict).toBe("findings");
    expect(hs?.findings.join("\n")).toContain("ghost.ts"); // phantom: not captured, not on disk
    expect(hs?.info.join("\n")).toContain("written.ts"); // exists-uncaptured: info only
    expect(hs?.info.join("\n")).toContain("outside-workspace"); // never probed
  });

  it("no capture stores at all → no-signal", () => {
    const byId = run(snap({ refs }));
    expect(byId["hallucinated-state"]?.verdict).toBe("no-signal");
  });
});

describe("opt-out", () => {
  it("a disabled detector reports disabled and produces no findings", () => {
    const byId = run(snap({ events: [ev({ childExitCode: 2 })] }), {
      enabled: { ...ALL_ON, "tool-error": false },
    });
    expect(byId["tool-error"]?.verdict).toBe("disabled");
    expect(byId["tool-error"]?.findings).toEqual([]);
  });
});
