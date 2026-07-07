import { describe, expect, it } from "vitest";
import {
  FIX_CHATTY_RATIO,
  FIX_CHATTY_SHARE,
  FIX_MEMORY_FILE_BYTES,
  FIX_MIN_EVENTS,
  FIX_READ_SHARE,
  FIX_WEAK_MIN_TOKENS,
  FIX_WEAK_RATIO,
  computeFixPlan,
} from "../src/fix.js";

// tokensFromBytes is ceil(bytes/4); INPUT_PRICE_PER_MTOK_USD = 3.0.
function ev(
  i: number,
  over: Partial<{
    sourceKind: string;
    label: string;
    rawBytes: number;
    returnedBytes: number;
    bytesSaved: number;
  }> = {},
) {
  const returnedBytes = over.returnedBytes ?? 1_000;
  const bytesSaved = over.bytesSaved ?? 0;
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: "2026-07-05T00:00:00.000Z",
    sourceKind: over.sourceKind ?? "file",
    label: over.label ?? "read",
    rawBytes: over.rawBytes ?? returnedBytes + bytesSaved,
    returnedBytes,
    bytesSaved,
    savingRatio: 0,
    summary: "",
    mode: "safe",
  } as never;
}

function events(n: number, over: Parameters<typeof ev>[1] = {}) {
  return Array.from({ length: n }, (_, i) => ev(i, over));
}

const SAVER_ON = { enabled: true, mode: "balanced" as const };

describe("computeFixPlan — R1 enable-saver", () => {
  it("fires for null saver and for disabled saver; appliable; sized by headline dollars", () => {
    for (const saver of [null, { enabled: false, mode: "safe" as const }]) {
      const plan = computeFixPlan(events(5, { returnedBytes: 4_000_000 }), {
        saver,
        memoryFiles: [],
      });
      const r1 = plan.actions.find((a) => a.kind === "enable-saver");
      expect(r1).toBeDefined();
      expect(r1?.appliable).toBe(true);
      expect(r1?.estDollarsReturned).toBeCloseTo(plan.headline.dollarsReturned);
    }
  });

  it("fires with zero events too (saver off is always actionable)", () => {
    const plan = computeFixPlan([], { saver: null, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).toContain("enable-saver");
  });

  it("does not fire when the saver is enabled", () => {
    const plan = computeFixPlan(events(5), { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("enable-saver");
  });
});

describe("computeFixPlan — R2 bump-saver-mode", () => {
  // 1 event: returned 4_000_000 bytes → 1_000_000 tokens (== FIX_WEAK_MIN_TOKENS),
  // saved 400_000 of raw 4_400_000 → overallSavingRatio ≈ 0.0909 < 0.5.
  const weak = events(1, { returnedBytes: 4_000_000, bytesSaved: 400_000 });

  it("fires only at safe + weak ratio + enough returned tokens", () => {
    const plan = computeFixPlan(weak, {
      saver: { enabled: true, mode: "safe" },
      memoryFiles: [],
    });
    const r2 = plan.actions.find((a) => a.kind === "bump-saver-mode");
    expect(r2).toBeDefined();
    expect(r2?.appliable).toBe(true);
  });

  it("does not fire at balanced or aggressive", () => {
    for (const mode of ["balanced", "aggressive"] as const) {
      const plan = computeFixPlan(weak, { saver: { enabled: true, mode }, memoryFiles: [] });
      expect(plan.actions.map((a) => a.kind)).not.toContain("bump-saver-mode");
    }
  });

  it("does not fire at exactly ratio 0.5 (strict <)", () => {
    // returned 2_000_000 + saved 2_000_000 of raw 4_000_000 → ratio exactly 0.5;
    // returned tokens 500_000 — bump the volume with 8 events to clear the token floor.
    const half = events(8, { returnedBytes: 2_000_000, bytesSaved: 2_000_000, rawBytes: 4_000_000 });
    const plan = computeFixPlan(half, { saver: { enabled: true, mode: "safe" }, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("bump-saver-mode");
  });

  it("does not fire below the returned-token floor", () => {
    const tiny = events(1, { returnedBytes: 3_999_996, bytesSaved: 400_000 }); // 999_999 tokens
    const plan = computeFixPlan(tiny, { saver: { enabled: true, mode: "safe" }, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("bump-saver-mode");
  });

  it("is mutually exclusive with R1 by construction", () => {
    const plan = computeFixPlan(weak, { saver: null, memoryFiles: [] });
    const kinds = plan.actions.map((a) => a.kind);
    expect(kinds).toContain("enable-saver");
    expect(kinds).not.toContain("bump-saver-mode");
  });
});

describe("computeFixPlan — R3 advise-tool-route", () => {
  // noisy: 20 events × 10_000 returned, no savings → share 200k/400k = 0.5 ≥ 0.25,
  // ratio 0 < 0.3, events 20 == FIX_MIN_EVENTS. quiet: 20 events × 10_000, fully saved raw.
  const mixed = [
    ...events(20, { sourceKind: "mcp-noisy", label: "call", returnedBytes: 10_000 }),
    ...events(20, {
      sourceKind: "file",
      label: "read",
      returnedBytes: 10_000,
      bytesSaved: 90_000,
      rawBytes: 100_000,
    }),
  ];

  it("fires per qualifying source with a ready-to-run command", () => {
    const plan = computeFixPlan(mixed, { saver: SAVER_ON, memoryFiles: [] });
    const r3 = plan.actions.filter((a) => a.kind === "advise-tool-route");
    expect(r3).toHaveLength(1);
    expect(r3[0]?.appliable).toBe(false);
    expect(r3[0]?.target).toBe("mcp-noisy");
    expect(r3[0]?.command).toContain('mega tools add');
    expect(r3[0]?.command).toContain("mcp-noisy");
  });

  it("does not fire below the event floor", () => {
    const few = [
      ...events(19, { sourceKind: "mcp-noisy", label: "call", returnedBytes: 10_000 }),
      ...events(20, {
        sourceKind: "file",
        label: "read",
        returnedBytes: 10_000,
        bytesSaved: 90_000,
        rawBytes: 100_000,
      }),
    ];
    const plan = computeFixPlan(few, { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("advise-tool-route");
  });
});

describe("computeFixPlan — R4 advise-outline", () => {
  it("fires when the read label dominates returned bytes", () => {
    // read: 20 × 20_000 = 400k of 500k total → share 0.8 ≥ 0.4, events 20.
    const readHeavy = [
      ...events(20, { sourceKind: "file", label: "read", returnedBytes: 20_000 }),
      ...events(20, { sourceKind: "proc", label: "exec", returnedBytes: 5_000 }),
    ];
    const plan = computeFixPlan(readHeavy, { saver: SAVER_ON, memoryFiles: [] });
    const r4 = plan.actions.find((a) => a.kind === "advise-outline");
    expect(r4).toBeDefined();
    expect(r4?.appliable).toBe(false);
  });

  it("does not fire below the share threshold", () => {
    // read: 20 × 5_000 = 100k of 500k → share 0.2 < 0.4.
    const balanced = [
      ...events(20, { sourceKind: "file", label: "read", returnedBytes: 5_000 }),
      ...events(20, { sourceKind: "proc", label: "exec", returnedBytes: 20_000 }),
    ];
    const plan = computeFixPlan(balanced, { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("advise-outline");
  });
});

describe("computeFixPlan — R5 advise-compress-memory-file", () => {
  it("fires strictly above the byte floor, per file", () => {
    const plan = computeFixPlan([], {
      saver: SAVER_ON,
      memoryFiles: [
        { path: "CLAUDE.md", bytes: FIX_MEMORY_FILE_BYTES + 1 },
        { path: "AGENTS.md", bytes: FIX_MEMORY_FILE_BYTES },
      ],
    });
    const r5 = plan.actions.filter((a) => a.kind === "advise-compress-memory-file");
    expect(r5).toHaveLength(1);
    expect(r5[0]?.target).toBe("CLAUDE.md");
    expect(r5[0]?.appliable).toBe(false);
    expect(r5[0]?.estDollarsReturned).toBeGreaterThan(0);
  });
});

describe("computeFixPlan — plan shape", () => {
  it("sorts actions by estDollarsReturned desc (title tiebreak) and never yields NaN", () => {
    const plan = computeFixPlan(events(25, { returnedBytes: 100_000 }), {
      saver: null,
      memoryFiles: [{ path: "CLAUDE.md", bytes: 20_000 }],
    });
    const est = plan.actions.map((a) => a.estDollarsReturned);
    expect([...est].sort((a, b) => b - a)).toEqual(est);
    for (const v of est) expect(Number.isFinite(v)).toBe(true);
  });

  it("threshold constants are the spec-locked values", () => {
    expect(FIX_MIN_EVENTS).toBe(20);
    expect(FIX_CHATTY_SHARE).toBe(0.25);
    expect(FIX_CHATTY_RATIO).toBe(0.3);
    expect(FIX_READ_SHARE).toBe(0.4);
    expect(FIX_WEAK_RATIO).toBe(0.5);
    expect(FIX_WEAK_MIN_TOKENS).toBe(1_000_000);
    expect(FIX_MEMORY_FILE_BYTES).toBe(16_384);
  });
});
