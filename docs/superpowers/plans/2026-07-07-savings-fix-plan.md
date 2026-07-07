# `mega savings fix` (Pro module 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated `mega savings fix [--apply]` command that turns waste findings into a deterministic fix plan — applying the safe ones (workspace saver enable/bump, Mega-Saver-owned config only) and printing ready-to-run advice for the rest.

**Architecture:** Fifth proprietary pure-fn module in `@megasaver/pro-analytics` (`computeFixPlan` over the existing `computeWasteBreakdown`/`computeWasteHeadline`) + a CLI command mirroring the m1–m4 shape (entitlement gate FIRST, lazy import). The only write path is the EXISTING `@megasaver/context-gate` saver-store API (`withActivationLock` + `writeExactRecord`); user repo files are stat'd for size only, never read or written.

**Tech Stack:** TypeScript strict ESM, Vitest, Citty, pnpm workspaces. Spec: `docs/superpowers/specs/2026-07-07-savings-fix-design.md` (risk HIGH).

**Execution notes:**
- Work in a feature worktree, branch `feat/cli-savings-fix`.
- Money math baseline: `tokensFromBytes = ceil(bytes/4)`; `INPUT_PRICE_PER_MTOK_USD = 3.0`.
- Pinned APIs: `resolveWorkspaceTokenSaverSettings(storeRoot, cwd, deps: ResolverDeps): ResolvedWorkspaceTokenSaver` + `nodeResolverDeps()` (a FACTORY — call it; passing the function itself is a TS2345 vitest won't catch) + `withActivationLock(storeRoot, fn)` + `writeExactRecord(storeRoot, workspaceKey, { enabled, mode, scope: "exact" })` + `readExactRecord` (all exported from `@megasaver/context-gate`); `encodeWorkspaceKey(cwd)` from `@megasaver/shared`.
- Store errors surfacing as stderr + exit ≠0 is citty `runMain` default behavior (same as m1–m4 siblings) — no defensive catch, no unit test for it.

---

### Task 1: `computeFixPlan` pure engine (TDD)

**Files:**
- Create: `packages/pro-analytics/test/fix.test.ts`
- Create: `packages/pro-analytics/src/fix.ts`
- Modify: `packages/pro-analytics/src/index.ts`
- Modify: `packages/pro-analytics/package.json` (add `"@megasaver/shared": "workspace:*"` to `dependencies` — `fix.ts` imports `TokenSaverMode` from it; without the declaration `tsc -b --noEmit` fails TS2307 even though vitest passes, because esbuild elides type-only imports) + `pnpm install`

- [ ] **Step 1: Write the failing test**

Create `packages/pro-analytics/test/fix.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/fix.test.ts`
Expected: FAIL — cannot resolve `../src/fix.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/pro-analytics/src/fix.ts`:

```ts
import type { TokenSaverMode } from "@megasaver/shared";
import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";
import { type WasteHeadline, computeWasteBreakdown, computeWasteHeadline } from "./insights.js";

export const FIX_MIN_EVENTS = 20;
export const FIX_CHATTY_SHARE = 0.25;
export const FIX_CHATTY_RATIO = 0.3;
export const FIX_READ_SHARE = 0.4;
export const FIX_WEAK_RATIO = 0.5;
export const FIX_WEAK_MIN_TOKENS = 1_000_000;
export const FIX_MEMORY_FILE_BYTES = 16_384;

export type FixActionKind =
  | "enable-saver"
  | "bump-saver-mode"
  | "advise-tool-route"
  | "advise-outline"
  | "advise-compress-memory-file";

export interface FixAction {
  kind: FixActionKind;
  appliable: boolean;
  title: string;
  detail: string;
  command: string | null;
  target: string | null;
  estDollarsReturned: number;
}

export interface FixSaverState {
  enabled: boolean;
  mode: TokenSaverMode;
}

export interface FixMemoryFile {
  path: string;
  bytes: number;
}

export interface FixPlan {
  headline: WasteHeadline;
  actions: FixAction[];
}

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

export function computeFixPlan(
  events: readonly TokenSaverEvent[],
  opts: { saver: FixSaverState | null; memoryFiles: readonly FixMemoryFile[] },
): FixPlan {
  const headline = computeWasteHeadline(events);
  const bySource = computeWasteBreakdown(events, { by: "source" });
  const byLabel = computeWasteBreakdown(events, { by: "label" });
  const actions: FixAction[] = [];

  if (opts.saver === null || !opts.saver.enabled) {
    actions.push({
      kind: "enable-saver",
      appliable: true,
      title: "Token saver is off for this workspace",
      detail:
        "Every oversized tool output flows into context uncompressed. Enabling at balanced compresses them evidence-preservingly.",
      command: null,
      target: null,
      estDollarsReturned: headline.dollarsReturned,
    });
  } else if (
    opts.saver.mode === "safe" &&
    headline.overallSavingRatio < FIX_WEAK_RATIO &&
    headline.tokensReturned >= FIX_WEAK_MIN_TOKENS
  ) {
    actions.push({
      kind: "bump-saver-mode",
      appliable: true,
      title: "Saver runs at safe but most bytes still pass through",
      detail: `Saving ratio ${(headline.overallSavingRatio * 100).toFixed(0)}% over ${headline.tokensReturned} returned tokens. balanced tightens the budget; aggressive stays a manual choice.`,
      command: null,
      target: null,
      estDollarsReturned: headline.dollarsReturned * (1 - headline.overallSavingRatio),
    });
  }

  for (const row of bySource) {
    if (
      row.returnedShare >= FIX_CHATTY_SHARE &&
      row.savingRatio < FIX_CHATTY_RATIO &&
      row.events >= FIX_MIN_EVENTS
    ) {
      actions.push({
        kind: "advise-tool-route",
        appliable: false,
        title: `"${row.key}" returns ${(row.returnedShare * 100).toFixed(0)}% of context bytes and compresses poorly`,
        detail:
          "Register it with the tool router so task routing can exclude it when irrelevant (advisor; nothing is blocked silently).",
        command: `mega tools add <project> --name "${row.key}" --category mcp --risk caution`,
        target: row.key,
        estDollarsReturned: row.dollarsReturned,
      });
    }
  }

  const readRow = byLabel.find((r) => r.key === "read");
  if (readRow && readRow.returnedShare >= FIX_READ_SHARE && readRow.events >= FIX_MIN_EVENTS) {
    actions.push({
      kind: "advise-outline",
      appliable: false,
      title: `File reads return ${(readRow.returnedShare * 100).toFixed(0)}% of context bytes`,
      detail:
        "Prefer outline-first reads (proxy_read_file with outline: true) — signatures now, bodies on demand. Unchanged re-reads are already deduped automatically.",
      command: null,
      target: "read",
      estDollarsReturned: readRow.dollarsReturned,
    });
  }

  for (const f of opts.memoryFiles) {
    if (f.bytes > FIX_MEMORY_FILE_BYTES) {
      actions.push({
        kind: "advise-compress-memory-file",
        appliable: false,
        title: `${f.path} is ${Math.round(f.bytes / 1024)}KB — loaded into every session`,
        detail:
          "Compress or split it; a product memory-file compressor ships as its own module.",
        command: null,
        target: f.path,
        estDollarsReturned: dollarsFromTokens(tokensFromBytes(f.bytes)),
      });
    }
  }

  actions.sort(
    (a, b) =>
      b.estDollarsReturned - a.estDollarsReturned ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
  return { headline, actions };
}
```

Append to `packages/pro-analytics/src/index.ts`:

```ts
export {
  type FixAction,
  type FixActionKind,
  type FixMemoryFile,
  type FixPlan,
  type FixSaverState,
  FIX_CHATTY_RATIO,
  FIX_CHATTY_SHARE,
  FIX_MEMORY_FILE_BYTES,
  FIX_MIN_EVENTS,
  FIX_READ_SHARE,
  FIX_WEAK_MIN_TOKENS,
  FIX_WEAK_RATIO,
  computeFixPlan,
} from "./fix.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/fix.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Full package suite**

Run: `pnpm --filter @megasaver/pro-analytics test`
Expected: PASS — no regressions (history/export/insights/forecast/roi untouched).

- [ ] **Step 6: Commit**

```bash
git add packages/pro-analytics/src/fix.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/fix.test.ts
git commit -m "feat(pro-analytics): computeFixPlan — deterministic waste remediation"
```

---

### Task 2: gated `runSavingsFix` — propose mode (TDD)

**Files:**
- Create: `apps/cli/test/commands/savings-fix.test.ts`
- Create: `apps/cli/src/commands/savings/fix.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/commands/savings-fix.test.ts` (harness mirrors
`apps/cli/test/commands/roi.test.ts` — Ed25519 test key, temp store, spy on
the proprietary compute):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSavingsFix } from "../../src/commands/savings/fix.js";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";

const proSpies = vi.hoisted(() => ({ computeFixPlan: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.computeFixPlan.mockImplementation(actual.computeFixPlan);
  return { ...actual, computeFixPlan: proSpies.computeFixPlan };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

function event(
  i: number,
  sourceKind: TokenSaverEvent["sourceKind"],
  returnedBytes: number,
): TokenSaverEvent {
  return {
    id: `e-${i}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt: "2023-11-05T00:00:00.000Z",
    sourceKind,
    label: "read",
    rawBytes: returnedBytes,
    returnedBytes,
    bytesSaved: 0,
    savingRatio: 0,
    summary: "s",
    mode: "balanced",
  };
}

const fixEvents: TokenSaverEvent[] = Array.from({ length: 25 }, (_, i) =>
  event(i, "file", 100_000),
);

function fixReader(): SavingsEventReader {
  return () => ({ events: fixEvents, eventsByProject: { "proj-1": fixEvents } });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-fix-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.computeFixPlan.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, {
    v: 1,
    tier: "pro",
    id: "cust-1",
    iat: 0,
    exp: null,
  });
  const res = activateLicense(root, key, { publicKey: keys.publicKey, now });
  expect(res.ok).toBe(true);
}

function baseInput(over: Partial<Parameters<typeof runSavingsFix>[0]> = {}) {
  return {
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    readAllEvents: fixReader(),
    readSaver: () => null,
    readMemoryFileSizes: () => [],
    writeSaver: vi.fn(),
    stdout,
    stderr,
    ...over,
  };
}

describe("runSavingsFix — gating", () => {
  it.each([{}, { apply: true }, { json: true }])(
    "with NO license (%o): upsell, exit 0, nothing read/computed/written",
    async (flags) => {
      const readAllEvents = vi.fn(fixReader());
      const readSaver = vi.fn(() => null);
      const readMemoryFileSizes = vi.fn(() => []);
      const writeSaver = vi.fn();

      const code = await runSavingsFix(
        baseInput({ readAllEvents, readSaver, readMemoryFileSizes, writeSaver, ...flags }),
      );

      expect(code).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("Mega Saver Pro");
      expect(text).toContain("mega license activate");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(readSaver).not.toHaveBeenCalled();
      expect(readMemoryFileSizes).not.toHaveBeenCalled();
      expect(writeSaver).not.toHaveBeenCalled();
      expect(proSpies.computeFixPlan).not.toHaveBeenCalled();
    },
  );
});

describe("runSavingsFix — propose mode (entitled)", () => {
  beforeEach(() => activatePro());

  it("prints tagged actions and the --apply footer; NEVER writes", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(baseInput({ writeSaver }));

    expect(code).toBe(0);
    expect(proSpies.computeFixPlan).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text).toContain("[apply]");
    expect(text).toContain("Token saver is off");
    expect(text).toContain("(est.)");
    expect(text).toContain("Run with --apply to apply 1 fix(es).");
    expect(writeSaver).not.toHaveBeenCalled();
  });

  it("advice-only plan omits the --apply footer", async () => {
    const code = await runSavingsFix(
      baseInput({
        readSaver: () => ({ enabled: true, mode: "balanced" }),
        readMemoryFileSizes: () => [{ path: "CLAUDE.md", bytes: 20_000 }],
      }),
    );

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[advice]");
    expect(text).toContain("CLAUDE.md");
    expect(text).not.toContain("Run with --apply");
  });

  it("no actions at all → honest empty line, exit 0", async () => {
    const code = await runSavingsFix(
      baseInput({
        readAllEvents: () => ({ events: [], eventsByProject: {} }),
        readSaver: () => ({ enabled: true, mode: "balanced" }),
      }),
    );

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Nothing to fix — no waste signals yet.");
  });

  it("--json emits { plan } without applied", async () => {
    const code = await runSavingsFix(baseInput({ json: true }));

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      plan: { actions: { kind: string }[] };
      applied?: unknown;
    };
    expect(parsed.plan.actions.map((a) => a.kind)).toContain("enable-saver");
    expect(parsed.applied).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/savings-fix.test.ts`
Expected: FAIL — cannot resolve `../../src/commands/savings/fix.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/commands/savings/fix.ts` (the `--apply` execution path
lands in Task 3; `apply` is accepted but only changes the footer here — the
Task 3 tests force the write behavior):

```ts
import type { KeyObject } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
  withActivationLock,
  writeExactRecord,
} from "@megasaver/context-gate";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { type TokenSaverMode, encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./shared.js";

// fix-specific upsell: the shared string says "historical savings analytics",
// which would misname this feature. Same activation mechanics.
export const FIX_UPSELL = `Waste remediation is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

export type FixSaverReader = () => { enabled: boolean; mode: TokenSaverMode } | null;
export type FixMemoryFileReader = () => { path: string; bytes: number }[];
export type FixSaverWriter = (rec: { enabled: boolean; mode: TokenSaverMode }) => void;

export function defaultSaverReader(storeRoot: string, cwd: string): FixSaverReader {
  return () => {
    const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
    if (r.source === "missing" || r.source === "invalid") return null;
    return { enabled: r.enabled, mode: r.mode };
  };
}

export function defaultMemoryFileReader(cwd: string): FixMemoryFileReader {
  return () => {
    const found: { path: string; bytes: number }[] = [];
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      try {
        const st = statSync(join(cwd, name));
        if (st.isFile()) found.push({ path: name, bytes: st.size });
      } catch {
        // absent — omitted; sizes only, content is never read.
      }
    }
    return found;
  };
}

export function defaultSaverWriter(storeRoot: string, cwd: string): FixSaverWriter {
  return (rec) =>
    withActivationLock(storeRoot, () =>
      writeExactRecord(storeRoot, encodeWorkspaceKey(cwd), { ...rec, scope: "exact" }),
    );
}

export type RunSavingsFixInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  readSaver: FixSaverReader;
  readMemoryFileSizes: FixMemoryFileReader;
  writeSaver: FixSaverWriter;
  apply?: boolean;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSavingsFix(input: RunSavingsFixInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST — on the free path nothing is read,
  // computed, or written, even with --apply/--json set (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(FIX_UPSELL);
    return 0;
  }

  const { computeFixPlan } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const saver = input.readSaver();
  const memoryFiles = input.readMemoryFileSizes();
  const plan = computeFixPlan(events, { saver, memoryFiles });

  const applied: { kind: string; was: string; now: string }[] = [];
  if (input.apply === true) {
    const was = saver === null ? "absent" : saver.enabled ? saver.mode : "disabled";
    for (const action of plan.actions) {
      if (!action.appliable) continue;
      input.writeSaver({ enabled: true, mode: "balanced" });
      applied.push({ kind: action.kind, was, now: "enabled/balanced" });
    }
  }

  if (input.json) {
    input.stdout(JSON.stringify(input.apply === true ? { plan, applied } : { plan }));
    return 0;
  }

  if (plan.actions.length === 0) {
    input.stdout("Nothing to fix — no waste signals yet.");
    return 0;
  }

  input.stdout(
    `${plan.actions.length} finding(s) · ${formatDollarsSaved(plan.headline.dollarsReturned)} (est.) returned so far`,
  );
  input.stdout("");
  plan.actions.forEach((action, i) => {
    const tag = action.appliable ? "apply" : "advice";
    input.stdout(
      `${i + 1}. [${tag}] ${action.title} — ~${formatDollarsSaved(action.estDollarsReturned)} (est.)`,
    );
    input.stdout(`   ${action.detail}`);
    if (action.command) input.stdout(`   $ ${action.command}`);
  });

  const appliableCount = plan.actions.filter((a) => a.appliable).length;
  if (input.apply === true) {
    input.stdout("");
    if (applied.length === 0) {
      input.stdout(`Nothing to apply — ${plan.actions.length} advice item(s) above.`);
    } else {
      for (const ap of applied) {
        input.stdout(`applied: ${ap.kind} (was: ${ap.was} → now: ${ap.now})`);
      }
    }
  } else if (appliableCount > 0) {
    input.stdout("");
    input.stdout(`Run with --apply to apply ${appliableCount} fix(es).`);
  }
  return 0;
}

export const savingsFixCommand = defineCommand({
  meta: {
    name: "fix",
    description:
      "Turn waste findings into fixes — apply the safe ones, advise the rest (Mega Saver Pro).",
  },
  args: {
    apply: {
      type: "boolean",
      default: false,
      description: "Apply the [apply]-tagged fixes (writes only Mega Saver settings).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const cwd = process.cwd();
    const code = await runSavingsFix({
      storeRoot,
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(storeInput),
      readSaver: defaultSaverReader(storeRoot, cwd),
      readMemoryFileSizes: defaultMemoryFileReader(cwd),
      writeSaver: defaultSaverWriter(storeRoot, cwd),
      apply: !!args.apply,
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/savings-fix.test.ts`
Expected: PASS (3 gating variants + 4 propose tests).
(If the CLI package's `@megasaver/pro-analytics` dist predates Task 1, rebuild
first: `pnpm --filter @megasaver/pro-analytics build`.)

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/savings/fix.ts apps/cli/test/commands/savings-fix.test.ts
git commit -m "feat(cli): mega savings fix — propose mode (gated)"
```

---

### Task 3: `--apply` path + register + README + changeset (TDD)

**Files:**
- Modify: `apps/cli/test/commands/savings-fix.test.ts` (append a describe block)
- Modify: `apps/cli/src/commands/savings/index.ts`
- Modify: `README.md` (Pro section)
- Create: `.changeset/savings-fix.md`

- [ ] **Step 1: Write the failing tests** — append to
`apps/cli/test/commands/savings-fix.test.ts`:

```ts
describe("runSavingsFix — apply mode (entitled)", () => {
  beforeEach(() => activatePro());

  it("--apply calls writeSaver once with enabled/balanced and prints was→now", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(baseInput({ apply: true, writeSaver }));

    expect(code).toBe(0);
    expect(writeSaver).toHaveBeenCalledTimes(1);
    expect(writeSaver).toHaveBeenCalledWith({ enabled: true, mode: "balanced" });
    const text = out.join("\n");
    expect(text).toContain("applied: enable-saver");
    expect(text).toContain("was: absent");
    expect(text).toContain("now: enabled/balanced");
  });

  it("--apply round-trips through the REAL saver store (default reader+writer)", async () => {
    const { defaultSaverReader, defaultSaverWriter } = await import(
      "../../src/commands/savings/fix.js"
    );
    const { readExactRecord } = await import("@megasaver/context-gate");
    const { encodeWorkspaceKey } = await import("@megasaver/shared");
    const cwd = "/tmp/fix-workspace";

    const code = await runSavingsFix(
      baseInput({
        apply: true,
        readSaver: defaultSaverReader(root, cwd),
        writeSaver: defaultSaverWriter(root, cwd),
      }),
    );

    expect(code).toBe(0);
    const rec = readExactRecord(root, encodeWorkspaceKey(cwd));
    expect(rec).toEqual({ kind: "v1-exact", enabled: true, mode: "balanced" });
  });

  it("--apply with an advice-only plan writes nothing and says so", async () => {
    const writeSaver = vi.fn();
    const code = await runSavingsFix(
      baseInput({
        apply: true,
        writeSaver,
        readSaver: () => ({ enabled: true, mode: "balanced" }),
        readMemoryFileSizes: () => [{ path: "CLAUDE.md", bytes: 20_000 }],
      }),
    );

    expect(code).toBe(0);
    expect(writeSaver).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Nothing to apply — 1 advice item(s) above.");
  });

  it("--apply --json emits { plan, applied }", async () => {
    const code = await runSavingsFix(baseInput({ apply: true, json: true, writeSaver: vi.fn() }));

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      plan: unknown;
      applied: { kind: string; was: string; now: string }[];
    };
    expect(parsed.applied).toEqual([
      { kind: "enable-saver", was: "absent", now: "enabled/balanced" },
    ]);
  });

  it("bump path reports was: safe", async () => {
    // 1 event, 4_000_000 returned bytes → 1M tokens, ratio ≈ 0.09 → R2 fires at safe.
    const weakEvents = [event(0, "file", 4_000_000)];
    const writeSaver = vi.fn();
    const code = await runSavingsFix(
      baseInput({
        apply: true,
        writeSaver,
        readAllEvents: () => ({ events: weakEvents, eventsByProject: {} }),
        readSaver: () => ({ enabled: true, mode: "safe" }),
      }),
    );

    expect(code).toBe(0);
    expect(writeSaver).toHaveBeenCalledWith({ enabled: true, mode: "balanced" });
    expect(out.join("\n")).toContain("was: safe");
  });
});

describe("defaultMemoryFileReader", () => {
  it("stats only existing files, size only", async () => {
    const { defaultMemoryFileReader } = await import("../../src/commands/savings/fix.js");
    const { mkdtempSync: mkTmp, writeFileSync } = await import("node:fs");
    const dir = mkTmp(join(tmpdir(), "megasaver-fix-md-"));
    writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(1_000));

    const files = defaultMemoryFileReader(dir)();
    expect(files).toEqual([{ path: "CLAUDE.md", bytes: 1_000 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests — apply-mode block MUST pass already for the write
path written in Task 2? NO — verify which fail**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/savings-fix.test.ts`
Expected: the Task-2 implementation already contains the apply loop, so most
pass; any FAILING assertion here is a real gap — fix `fix.ts` minimally until
green. If ALL pass on first run, mutation-check the invariant instead: comment
out the `if (!action.appliable) continue;` line locally, confirm the
advice-only test fails, restore it.

- [ ] **Step 3: Register the command** — in
`apps/cli/src/commands/savings/index.ts` add:

```ts
import { savingsFixCommand } from "./fix.js";
```

to the imports, add `fix: savingsFixCommand,` wherever the group wires its
`subCommands` (check the bottom of the file — mirror how `forecast` is
registered), and append to the exports:

```ts
export {
  type FixMemoryFileReader,
  type FixSaverReader,
  type FixSaverWriter,
  type RunSavingsFixInput,
  FIX_UPSELL,
  defaultMemoryFileReader,
  defaultSaverReader,
  defaultSaverWriter,
  runSavingsFix,
  savingsFixCommand,
} from "./fix.js";
```

- [ ] **Step 4: README** — in the Pro code block, after the `mega roi` lines:

```sh
mega savings fix                  # turn waste findings into fixes (Pro)
mega savings fix --apply          # apply the safe ones (saver settings only)
```

After the `mega roi` bullet:

```md
- `mega savings fix [--apply]` — maps each waste finding to a remediation:
  applies the safe ones itself (workspace saver enable/bump — Mega Saver's
  own settings, never your repo files) and prints ready-to-run advice for
  the rest.
```

- [ ] **Step 5: Changeset** — create `.changeset/savings-fix.md`:

```md
---
"@megasaver/cli": minor
---

`mega savings fix` — turns waste findings into a deterministic fix plan;
`--apply` executes the safe fixes (workspace saver settings only) and the
rest ship as ready-to-run advice.
```

- [ ] **Step 6: Run the full CLI suite**

Run: `pnpm --filter @megasaver/cli exec vitest run`
Expected: all green (build `@megasaver/gui` bridge first if the worktree is
fresh: `pnpm --filter @megasaver/gui build`).

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/savings/fix.ts apps/cli/test/commands/savings-fix.test.ts apps/cli/src/commands/savings/index.ts README.md .changeset/savings-fix.md
git commit -m "feat(cli): savings fix --apply + register + README + changeset"
```

---

### Task 4: verification + smoke + reviewers (HIGH gates)

- [ ] **Step 1: Full verify**

Run: `TURBO_FORCE=true pnpm verify`
Expected: biome + tsc + vitest + conventions:check ALL green (force the turbo
cache — a cache replay masked a real failure once before).

- [ ] **Step 2: E2E smoke** (build first: `pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli run bundle` if using the bundle, else `node apps/cli/dist/cli.js`)

```bash
STORE=$(mktemp -d)
CLI="node apps/cli/dist/cli.js"
$CLI savings fix --store "$STORE"                       # free → upsell
KEY=$(node scripts/license/issue.mjs smoke-fix --exp <tomorrow-ISO> --priv /Users/halitozger/Desktop/MegaSaver/scripts/license/.private-key.pem)
$CLI license activate "$KEY" --store "$STORE"           # Pro activated
$CLI savings fix --store "$STORE"                       # plan (R1 expected: saver off)
$CLI savings fix --store "$STORE" --apply               # applied: enable-saver (was: absent)
$CLI session saver status <any> --store "$STORE" 2>/dev/null || true
$CLI savings fix --store "$STORE"                       # R1 no longer fires
rm -rf "$STORE"
```
Expected: upsell → plan with `[apply]` → `applied: enable-saver (was: absent → now: enabled/balanced)` → subsequent plan without the enable action. Do NOT print the license key into any log.

- [ ] **Step 3: Reviewer gates (HIGH)**

Per `docs/conventions/process-discipline.md` + spec §Security: code-reviewer
AND critic as separate fresh-context passes (the critic mutation-tests the
gate spies and the propose-mode-never-writes invariant), then the 3-lens
holistic final review (code-reviewer + adversarial critic + honesty/docs)
used for module 4, then `superpowers:finishing-a-development-branch`.
