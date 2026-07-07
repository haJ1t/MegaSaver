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
    const half = events(8, {
      returnedBytes: 2_000_000,
      bytesSaved: 2_000_000,
      rawBytes: 4_000_000,
    });
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

  it("R2 sizes by the uncompressed remainder: dollarsReturned × (1 − ratio)", () => {
    const plan = computeFixPlan(weak, { saver: { enabled: true, mode: "safe" }, memoryFiles: [] });
    const r2 = plan.actions.find((a) => a.kind === "bump-saver-mode");
    // weak: returned 4_000_000 bytes → 1_000_000 tokens → $3.00; ratio 400_000/4_400_000.
    expect(r2?.estDollarsReturned).toBeCloseTo(3 * (1 - 400_000 / 4_400_000));
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
    expect(r3[0]?.command).toContain("mega tools add");
    expect(r3[0]?.command).toContain("mcp-noisy");
    // The command must be runnable against `mega tools add`: real flags, a
    // description, a valid risk, and a category from the closed schema. The
    // "mcp-noisy" key is not a real sourceKind, so it falls back to filesystem.
    expect(r3[0]?.command).toContain("--risk medium");
    expect(r3[0]?.command).toContain("--description");
    expect(r3[0]?.command).toContain("--category filesystem");
    expect(r3[0]?.command).not.toContain("--category mcp");
    expect(r3[0]?.command).not.toContain("--risk caution");
  });

  it("maps a real sourceKind to a router-safe category (command → filesystem)", () => {
    const chatty = [
      ...events(20, { sourceKind: "command", label: "exec", returnedBytes: 10_000 }),
      ...events(20, {
        sourceKind: "file",
        label: "read",
        returnedBytes: 10_000,
        bytesSaved: 90_000,
        rawBytes: 100_000,
      }),
    ];
    const plan = computeFixPlan(chatty, { saver: SAVER_ON, memoryFiles: [] });
    const r3 = plan.actions.find((a) => a.kind === "advise-tool-route" && a.target === "command");
    expect(r3?.command).toContain('--name "command"');
    expect(r3?.command).toContain("--category filesystem");
    expect(r3?.command).toContain("--risk medium");
  });

  it("never emits a router-blocked category for any real sourceKind", () => {
    // The tool router hard-blocks dangerous/deploy/database from every route
    // (BLOCKED_CATEGORIES, pre-relevance), while this advice promises
    // relevance-based exclusion — so only non-blocked categories may appear.
    for (const kind of ["file", "command", "fetch", "grep"] as const) {
      const quietKind = kind === "file" ? "grep" : "file";
      const chatty = [
        ...events(20, { sourceKind: kind, label: "call", returnedBytes: 10_000 }),
        ...events(20, {
          sourceKind: quietKind,
          label: "quiet",
          returnedBytes: 10_000,
          bytesSaved: 90_000,
          rawBytes: 100_000,
        }),
      ];
      const plan = computeFixPlan(chatty, { saver: SAVER_ON, memoryFiles: [] });
      const r3 = plan.actions.find((a) => a.kind === "advise-tool-route" && a.target === kind);
      const category = r3?.command?.match(/--category (\S+)/)?.[1];
      expect(["filesystem", "search", "browser"]).toContain(category);
    }
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

  it("R3 sizes by the row's returned dollars", () => {
    const plan = computeFixPlan(mixed, { saver: SAVER_ON, memoryFiles: [] });
    const r3 = plan.actions.find((a) => a.kind === "advise-tool-route");
    // noisy returned 200_000 bytes → 50_000 tokens → $0.15.
    expect(r3?.estDollarsReturned).toBeCloseTo(0.15);
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

  it("does not fire below the event floor even when reads dominate", () => {
    // read: 19 × 20_000 = 380k of 480k → share ≈ 0.79 ≥ 0.4, but events 19 < 20.
    const fewReads = [
      ...events(19, { sourceKind: "file", label: "read", returnedBytes: 20_000 }),
      ...events(20, { sourceKind: "proc", label: "exec", returnedBytes: 5_000 }),
    ];
    const plan = computeFixPlan(fewReads, { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("advise-outline");
  });
});

describe("computeFixPlan — exact threshold boundaries", () => {
  it("R3 fires at returnedShare exactly 0.25 (inclusive)", () => {
    // noisy 20 × 5_000 = 100k; file 20 × 15_000 = 300k → share exactly 0.25, ratio 0 < 0.3.
    const mixed = [
      ...events(20, { sourceKind: "mcp-noisy", label: "call", returnedBytes: 5_000 }),
      ...events(20, { sourceKind: "file", label: "read", returnedBytes: 15_000 }),
    ];
    const plan = computeFixPlan(mixed, { saver: SAVER_ON, memoryFiles: [] });
    expect(
      plan.actions.some((a) => a.kind === "advise-tool-route" && a.target === "mcp-noisy"),
    ).toBe(true);
  });

  it("R3 does not fire at savingRatio exactly 0.3 (strict <)", () => {
    // noisy: raw 10_000, saved 3_000, returned 7_000 → ratio exactly 0.3;
    // share 140k/160k = 0.875 ≥ 0.25; events 20.
    const mixed = [
      ...events(20, {
        sourceKind: "mcp-noisy",
        label: "call",
        rawBytes: 10_000,
        bytesSaved: 3_000,
        returnedBytes: 7_000,
      }),
      ...events(20, { sourceKind: "file", label: "read", returnedBytes: 1_000 }),
    ];
    const plan = computeFixPlan(mixed, { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).not.toContain("advise-tool-route");
  });

  it("R4 fires at read returnedShare exactly 0.4 (inclusive)", () => {
    // read 20 × 10_000 = 200k of 500k → share exactly 0.4.
    const mixed = [
      ...events(20, { sourceKind: "file", label: "read", returnedBytes: 10_000 }),
      ...events(20, { sourceKind: "proc", label: "exec", returnedBytes: 15_000 }),
    ];
    const plan = computeFixPlan(mixed, { saver: SAVER_ON, memoryFiles: [] });
    expect(plan.actions.map((a) => a.kind)).toContain("advise-outline");
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

  it("titles show only the basename of a caller-supplied path", () => {
    const plan = computeFixPlan([], {
      saver: SAVER_ON,
      memoryFiles: [{ path: "/Users/victim/secret-proj/CLAUDE.md", bytes: 20_000 }],
    });
    const r5 = plan.actions.filter((a) => a.kind === "advise-compress-memory-file");
    expect(r5[0]?.title).toContain("CLAUDE.md");
    expect(r5[0]?.title).not.toContain("secret-proj");
    expect(r5[0]?.target).toBe("/Users/victim/secret-proj/CLAUDE.md");
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
