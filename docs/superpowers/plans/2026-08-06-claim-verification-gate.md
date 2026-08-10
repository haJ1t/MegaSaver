# Claim-Verification Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Tests pass" claims become checkable against stored exec receipts: complete the receipt (child exit code on the existing event rows), scan caller-provided text for success claims, and join the two in a time window.

**Architecture:** The exec orchestrators already persist a `TokenSaverEvent` per run (`sourceKind: "command"`, redacted `label`, `createdAt`, `chunkSetId`); one additive-optional `childExitCode` field completes it into a receipt. A new CLI-side pure engine (`scanClaims` → `receiptsFromEvents` → `joinClaimsToReceipts`) powers `mega verify claims`; an opt-in Stop hook reminds a live session that recorded no recent receipt. Nothing new is persisted except the one integer field.

**Tech Stack:** TypeScript strict ESM, Zod, Citty, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-06-claim-verification-gate-design.md`

## Global Constraints

- Claim regexes are linear-time: every quantifier bounded (`[ \t]{1,3}` gaps, fixed-word alternations); the 6-pattern list is LOCKED (Task 2); any pattern edit re-runs Task 3's guard suite.
- Growth-ratio guard tests measure ratios, never absolute wall-clock and never a runtime lower bound: n = 2 MiB vs 4n = 8 MiB, minimise per SIZE then divide, threshold 8, calibrated repeat count, explicit per-test timeout, `retry: 3` (wiki `concepts/redos-growth-ratio-measurement`).
- `MAX_CLAIMS_INPUT_BYTES = 8_388_608` — the shipped cap the guard sizes against (wiki `concepts/redos-guard-testing`: size the guard at the shipped cap).
- `DEFAULT_WINDOW_MINUTES = 30`; `--window` integer 1..1440.
- `childExitCode` is additive-optional on BOTH event schemas; `null` = bound-killed child (mirrors `run-command.ts:196`), absent = pre-C3 row = unrecorded; written only by `runOutputExecCommand` and `runOverlayOutputExecCommand`.
- Verdicts are a closed union: `verified | exit-mismatch | exit-unrecorded | no-receipt`; default exit 0; `--strict` exits 1 only on `no-receipt` / `exit-mismatch`.
- apps/cli reaches stats symbols ONLY via `@megasaver/core` re-exports (`FORBIDDEN_DEPENDENCIES` pin, `apps/cli/test/dependency-graph.test.ts:52`).
- Stop hook: warn-only, fail-open, ALWAYS exit 0, off by default, never `decision: "block"`.
- JSON policy: success = single JSON doc on stdout; failure = text stderr + empty stdout + exit 1. Exception (documented, `mega connector status` precedent): a `--strict` gate failure prints the report and exits 1.
- Commits per §10: conventional, subject ≤ 50 chars, imperative.

---

### Task 1: `childExitCode` on exec receipt events

**Files:**
- Modify: `packages/stats/src/event.ts` (both schemas)
- Modify: `packages/context-gate/src/run-command.ts` (registry event literal at ~`:433`, overlay event literal at ~`:679`)
- Test: `packages/stats/test/receipt-exit-code.test.ts` (new)
- Test: `packages/context-gate/test/exec-receipt-exit-code.test.ts` (new)

**Interfaces:**
- `tokenSaverEventSchema` / `overlayTokenSaverEventSchema` gain `childExitCode: z.number().int().nullable().optional()`.
- `TokenSaverEvent` / `OverlayTokenSaverEvent` gain `childExitCode?: number | null` (inferred).

- [ ] **Step 1: Write the failing schema tests**

`packages/stats/test/receipt-exit-code.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { overlayTokenSaverEventSchema, tokenSaverEventSchema } from "../src/event.js";

const BASE = {
  id: "evt-1",
  sessionId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-06T12:00:00.000Z",
  sourceKind: "command",
  label: "grep error src",
  rawBytes: 2000,
  returnedBytes: 500,
  bytesSaved: 1500,
  savingRatio: 0.75,
  summary: "3 kept",
};

const OVERLAY_BASE = {
  ...BASE,
  sessionId: undefined,
  projectId: undefined,
  liveSessionId: "33333333-3333-4333-8333-333333333333",
  workspaceKey: "0123456789abcdef",
};

describe("childExitCode receipt field", () => {
  it("parses a clean-exit receipt (0)", () => {
    const parsed = tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBe(0);
  });

  it("parses null — a bound-killed child has no meaningful exit code", () => {
    const parsed = tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBeNull();
  });

  it("keeps pre-C3 rows parsing — absence means UNRECORDED, never zero", () => {
    const parsed = tokenSaverEventSchema.safeParse(BASE);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBeUndefined();
  });

  it("rejects a stringly exit code and a float", () => {
    expect(tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: "0" }).success).toBe(false);
    expect(tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: 1.5 }).success).toBe(false);
  });

  it("overlay schema carries the same field with the same semantics", () => {
    const { sessionId: _s, projectId: _p, ...overlay } = OVERLAY_BASE;
    expect(overlayTokenSaverEventSchema.safeParse({ ...overlay, childExitCode: 2 }).success).toBe(
      true,
    );
    expect(overlayTokenSaverEventSchema.safeParse(overlay).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/stats test -- receipt-exit-code`. Expected: the `childExitCode` cases fail with Zod `unrecognized_keys` (both schemas are `.strict()`).

- [ ] **Step 3: Implement the schema field**

In `packages/stats/src/event.ts`, next to `deltaBytesField` (same additive-optional migration precedent):

```typescript
// C3 receipt completion: the child's exit code IS the verification evidence
// (claim-verification gate). null mirrors capture semantics — a bound-killed
// child has no meaningful exit code (context-gate run-command.ts). Optional so
// every pre-C3 JSONL row keeps parsing: absence means UNRECORDED, never 0.
const childExitCodeField = z.number().int().nullable().optional();
```

Add `childExitCode: childExitCodeField,` to BOTH object literals (`tokenSaverEventSchema`, `overlayTokenSaverEventSchema`).

- [ ] **Step 4: Run and pass** — `pnpm --filter @megasaver/stats test -- receipt-exit-code`, then the full stats suite.

- [ ] **Step 5: Write the failing writer tests**

`packages/context-gate/test/exec-receipt-exit-code.test.ts` — copy the fake-child harness from `packages/context-gate/test/ledger-signed-delta.test.ts` (`makeChild`, `spawnMock`, `registry`, the `PROJECT_ID`/`SESSION_ID`/`WK`/`LSID`/`NOW`/`ROOT_PID` constants, tmp store setup):

```typescript
import { readEvents, readOverlayEvents } from "@megasaver/stats";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";
// ... harness copied from ledger-signed-delta.test.ts ...

const OUTPUT = "ok: 12 tests passed\n";

function execInput(child: FakeChild, newId: string) {
  return {
    registry: registry(projectRoot),
    storeRoot: store,
    sessionId: SESSION_ID,
    command: "grep",
    args: ["error"],
    intent: "verify the run",
    originPid: ROOT_PID,
    timeoutMs: 300_000,
    maxBytes: 20_000_000,
    now: () => NOW,
    newId: () => newId,
    loadPermissions: () => null,
    spawn: spawnMock(child),
  };
}

describe("exec receipts record the child exit code", () => {
  it("records 0 on a clean run", async () => {
    const child = makeChild();
    const pending = runOutputExecCommand(execInput(child, "cs-receipt-0"));
    child.stdout.emit("data", Buffer.from(OUTPUT));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const [event] = readEvents({ root: store }, PROJECT_ID, SESSION_ID);
    expect(event?.childExitCode).toBe(0);
  });

  it("records the real non-zero code, not a clamp", async () => {
    const child = makeChild();
    const pending = runOutputExecCommand(execInput(child, "cs-receipt-2"));
    child.stdout.emit("data", Buffer.from("FAIL 3 tests\n"));
    child.emit("close", 2);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    const [event] = readEvents({ root: store }, PROJECT_ID, SESSION_ID);
    expect(event?.childExitCode).toBe(2);
  });
});
```

Add a third case driving `runOverlayOutputExecCommand` — the invocation below mirrors the shape shipped in `ledger-signed-delta.test.ts:344-373` (same `WK`/`LSID` fixtures, same `as unknown as Parameters<...>` cast that file uses):

```typescript
  it("records the overlay receipt exit code", async () => {
    const child = makeChild();
    const pending = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      command: "grep",
      args: ["error"],
      intent: "verify the run",
      originPid: ROOT_PID,
      mode: "balanced",
      storeRawOutput: true,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-receipt-ov",
      spawn: spawnMock(child),
    } as unknown as Parameters<typeof runOverlayOutputExecCommand>[0]);
    child.stdout.emit("data", Buffer.from(OUTPUT));
    child.emit("close", 0);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);

    expect(readOverlayEvents({ root: store }, WK, LSID)[0]?.childExitCode).toBe(0);
  });
```

- [ ] **Step 6: Run and observe the expected failure** — `pnpm --filter @megasaver/context-gate test -- exec-receipt-exit-code`. Expected: `childExitCode` is `undefined` on all three events.

- [ ] **Step 7: Implement the writers** — in `packages/context-gate/src/run-command.ts`, add to BOTH `sourceKind: "command"` event literals (registry ~`:433`, overlay ~`:679`):

```typescript
    // C3 receipt: outcome.capture.childExitCode is null exactly when the run
    // was bound-killed (timeout/max_bytes) — persist it as-is, no clamping.
    childExitCode: outcome.capture.childExitCode,
```

- [ ] **Step 8: Run and pass** — `pnpm --filter @megasaver/context-gate test`, `pnpm --filter @megasaver/stats test`.
- [ ] **Step 9: Commit** — `feat(stats): record child exit code on exec receipts`

---

### Task 2: Locked claim patterns + `scanClaims`

**Files:**
- Create: `apps/cli/src/commands/verify/claim-patterns.ts`
- Test: `apps/cli/test/verify/claim-patterns.test.ts` (new dir, sibling precedent `apps/cli/test/audit/`)

**Interfaces:**
- `export type ClaimPattern = { id: string; regex: RegExp }`
- `export const CLAIM_PATTERNS: readonly ClaimPattern[]`
- `export const MAX_CLAIMS_INPUT_BYTES = 8_388_608`
- `export type DetectedClaim = { patternId: string; excerpt: string; index: number }`
- `export function scanClaims(text: string): DetectedClaim[]`

- [ ] **Step 1: Write the failing detection tests**

```typescript
import { describe, expect, it } from "vitest";
import { CLAIM_PATTERNS, scanClaims } from "../../src/commands/verify/claim-patterns.js";

describe("scanClaims — locked success-claim patterns", () => {
  const positives: ReadonlyArray<readonly [string, string]> = [
    ["All tests pass.", "tests-pass"],
    ["tests are passing now", "tests-pass"],
    ["everything is done, all green", "all-green"],
    ["all checks passed", "all-green"],
    ["the build succeeds on main", "build-succeeds"],
    ["Build is green after the fix", "build-succeeds"],
    ["the test suite is green", "suite-green"],
    ["suite passes locally", "suite-green"],
    ["pnpm verify passes", "verify-green"],
    ["lint is clean and typecheck passed", "lint-clean"],
  ];
  for (const [text, id] of positives) {
    it(`detects "${text}" as ${id}`, () => {
      expect(scanClaims(text).map((c) => c.patternId)).toContain(id);
    });
  }

  it("does not fire on failures or embedded words", () => {
    expect(scanClaims("tests fail on CI")).toEqual([]);
    expect(scanClaims("the password is rotated")).toEqual([]); // \b guard
    expect(scanClaims("compass points north")).toEqual([]);
  });

  it("fires on claim-shaped text regardless of intent (documented, not fought)", () => {
    // The gate reports evidence presence for claim-shaped text; the operator
    // reads the excerpt. No lookarounds to guess intent.
    expect(scanClaims("we should make the tests pass eventually").map((c) => c.patternId)).toContain(
      "tests-pass",
    );
  });

  it("returns claims sorted by index with a bounded single-line excerpt", () => {
    const text = `${"pad ".repeat(30)}tests pass\nand later the build succeeded`;
    const claims = scanClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims[0]?.index).toBeLessThan(claims[1]?.index ?? 0);
    for (const claim of claims) {
      expect(claim.excerpt.length).toBeLessThanOrEqual(80);
      expect(claim.excerpt).not.toContain("\n");
    }
  });

  it("locks the pattern-id list — additions must re-run the ReDoS guard suite", () => {
    expect(CLAIM_PATTERNS.map((p) => p.id)).toEqual([
      "tests-pass",
      "all-green",
      "build-succeeds",
      "suite-green",
      "verify-green",
      "lint-clean",
    ]);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/cli test -- claim-patterns`. Expected: module not found.

- [ ] **Step 3: Implement**

```typescript
export type ClaimPattern = { id: string; regex: RegExp };

// LOCKED list (spec Locked Decision 2). Linear-time by construction: fixed-word
// alternations joined by BOUNDED `[ \t]{1,3}` gaps — no unbounded run before a
// required literal (wiki concepts/unbounded-run-redos, the class these must
// never join). Any edit here re-runs apps/cli/test/verify/claim-patterns-redos.
export const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "tests-pass",
    regex:
      /\b(?:all[ \t]{1,3})?tests?[ \t]{1,3}(?:are[ \t]{1,3})?(?:pass(?:es|ed|ing)?|green)\b/gi,
  },
  {
    id: "all-green",
    regex: /\ball[ \t]{1,3}(?:green|checks[ \t]{1,3}pass(?:es|ed|ing)?)\b/gi,
  },
  {
    id: "build-succeeds",
    regex: /\bbuild[ \t]{1,3}(?:succeed(?:s|ed)?|pass(?:es|ed|ing)?|is[ \t]{1,3}green)\b/gi,
  },
  {
    id: "suite-green",
    regex: /\b(?:test[ \t]{1,3})?suite[ \t]{1,3}(?:is[ \t]{1,3})?(?:green|pass(?:es|ed|ing))\b/gi,
  },
  {
    id: "verify-green",
    regex: /\bpnpm[ \t]{1,3}verify[ \t]{1,3}(?:is[ \t]{1,3})?(?:green|pass(?:es|ed|ing))\b/gi,
  },
  {
    id: "lint-clean",
    regex: /\b(?:lint|typecheck)[ \t]{1,3}(?:is[ \t]{1,3})?(?:clean|green|pass(?:es|ed|ing))\b/gi,
  },
];

// Shipped input cap: runVerifyClaims refuses larger input at the boundary, so
// this is the worst case the ReDoS guard must cover (redos-guard-testing rule:
// size the guard at the shipped cap).
export const MAX_CLAIMS_INPUT_BYTES = 8_388_608;

export type DetectedClaim = { patternId: string; excerpt: string; index: number };

const EXCERPT_MAX = 80;
const CONTEXT_CHARS = 20;

function excerptAt(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const flat = text
    .slice(start, index + matchLength + CONTEXT_CHARS)
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX - 1)}…`;
}

export function scanClaims(text: string): DetectedClaim[] {
  const claims: DetectedClaim[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const matched = match[0] ?? "";
      const index = match.index ?? 0;
      claims.push({ patternId: pattern.id, excerpt: excerptAt(text, index, matched.length), index });
    }
  }
  return claims.sort((a, b) => a.index - b.index || a.patternId.localeCompare(b.patternId));
}
```

(The `\s+` in `excerptAt` runs only over a ≤ ~130-char slice and has no required follower — not the unbounded-run shape.)

- [ ] **Step 4: Run and pass** — `pnpm --filter @megasaver/cli test -- claim-patterns`.
- [ ] **Step 5: Commit** — `feat(cli): claim scanner with locked patterns`

---

### Task 3: ReDoS growth-ratio guard for the claim patterns

**Files:**
- Test: `apps/cli/test/verify/claim-patterns-redos.test.ts` (new)

**Interfaces:** none (test-only). Fences Task 2's `scanClaims` through its public entry.

- [ ] **Step 1: Write the guard suite** (green on the bounded patterns by design — its red is proven by revert in Step 3):

```typescript
import { describe, expect, it } from "vitest";
import {
  CLAIM_PATTERNS,
  MAX_CLAIMS_INPUT_BYTES,
  scanClaims,
} from "../../src/commands/verify/claim-patterns.js";

// Instrument per wiki concepts/redos-growth-ratio-measurement:
// - A ratio, not a ceiling, because there is no fixed defect cost to separate
//   from: input is arbitrary text up to the shipped cap and the corpus is
//   synthetic. 4n IS the shipped cap (MAX_CLAIMS_INPUT_BYTES) — no caller can
//   present a larger scan.
// - 4x size step: linear predicts ~4.0, the unbounded-run defect class
//   measured 12.7–18.5x in prior instances; threshold 8 leaves ~2x margin on
//   both sides.
// - Minimise per SIZE across trials, then divide — never min-of-ratios (it
//   pairs a noisy small with a clean large and under-reports growth).
// - Repeat count calibrated from one real call, so a quadratic revert
//   collapses to a single repeat instead of a loop vitest cannot interrupt.
// - retry: 3 for parallel-turbo noise (the session-hints precedent). If this
//   still flakes under full fan-out, follow that file's escalation: replace
//   the ratio with a ceiling at the shipped cap once a measured separation
//   exists. Never assert a runtime lower bound.
const SMALL = MAX_CLAIMS_INPUT_BYTES / 4; // 2 MiB
const LARGE = MAX_CLAIMS_INPUT_BYTES; // 8 MiB — the shipped cap
const RATIO_THRESHOLD = 8;
const TRIALS = 3;
const TARGET_SAMPLE_MS = 50;

function repeatTo(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

// Near-miss shapes: starts that enter a pattern and fail. The word-char run
// probes the \b-guarded heads; the whitespace shape probes the bounded
// `[ \t]{1,3}` gaps (exactly where an edit would reintroduce an unbounded
// `\s+`); the truncated-claim soup probes the alternation tails.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a word-char run", "x"],
  ["a claim head before a whitespace run", "tests \t \t \t \t"],
  ["truncated-claim soup", "all tests pas build succee pnpm verify gree "],
];

function minMsPerSize(input: string, repeats: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = performance.now();
    for (let r = 0; r < repeats; r += 1) scanClaims(input);
    const ms = (performance.now() - started) / repeats;
    if (ms < best) best = ms;
  }
  return best;
}

describe("claim patterns stay linear up to the shipped input cap", () => {
  for (const [label, unit] of SHAPES) {
    it(
      `grows ~linearly from 2 MiB to 8 MiB of ${label}`,
      { retry: 3, timeout: 120_000 },
      () => {
        const small = repeatTo(unit, SMALL);
        const large = repeatTo(unit, LARGE);

        // Duration-floor calibration: one real call sizes the repeat count so
        // a linear sample spends ~TARGET_SAMPLE_MS (below ~5 ms a ratio
        // measures the scheduler), and a quadratic revert drops to 1 repeat.
        const probeMs = Math.max(minMsPerSize(small, 1), 0.5);
        const repeats = Math.max(1, Math.round(TARGET_SAMPLE_MS / probeMs));

        const smallMs = minMsPerSize(small, repeats);
        const largeMs = minMsPerSize(large, repeats);

        expect(largeMs / smallMs).toBeLessThan(RATIO_THRESHOLD);
      },
    );
  }
});

describe("guard corpus is not vacuous", () => {
  // redos-guard-testing rule: assert a minimum match count before asserting
  // anything about what a corpus produced. Every locked pattern must fire at
  // least once, or the growth measurement above proved nothing for it.
  const SEEDED =
    "All tests pass. all green. Build succeeded and build is green. " +
    "The test suite is green. pnpm verify passes. lint is clean. " +
    "typecheck passed. all checks passed. tests are passing. suite passes.";

  it("every locked pattern matches the seeded corpus at least once", () => {
    const hits = scanClaims(SEEDED);
    for (const pattern of CLAIM_PATTERNS) {
      expect(
        hits.some((claim) => claim.patternId === pattern.id),
        `pattern ${pattern.id} never fired`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and pass** — `pnpm --filter @megasaver/cli test -- claim-patterns-redos` (both describes green; note the measured smallMs/largeMs in the PR notes).
- [ ] **Step 3: Prove the guard non-vacuous by revert** — temporarily change the `tests-pass` gap after `tests?` from `[ \t]{1,3}` to `[^\n]*?` (the realistic "match anything between" regression), rerun: the whitespace-run and truncated-soup shapes MUST go red on the ratio assertion (each `tests` head scans the rest of a single giant line — quadratic). Quote the measured red ratio in the commit body, then restore the pattern. A margin claim is only load-bearing if the revert was actually performed (wiki `concepts/redos-growth-ratio-measurement`).
- [ ] **Step 4: Commit** — `test(cli): fence claim patterns against superlinear growth`

---

### Task 4: `VerificationReceipt` view over exec events

**Files:**
- Create: `apps/cli/src/commands/verify/receipts.ts`
- Test: `apps/cli/test/verify/receipts.test.ts` (new)

**Interfaces:**
- `export type ReceiptExit = { kind: "code"; code: number } | { kind: "terminated" } | { kind: "unrecorded" }`
- `export type VerificationReceipt = { command: string; exit: ReceiptExit; recordedAt: string; sessionId: string; chunkSetId?: string }`
- `export function receiptsFromEvents(events: readonly TokenSaverEvent[]): VerificationReceipt[]`

- [ ] **Step 1: Write the failing tests**

```typescript
import type { TokenSaverEvent } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { receiptsFromEvents } from "../../src/commands/verify/receipts.js";

function event(overrides: Partial<TokenSaverEvent>): TokenSaverEvent {
  return {
    id: "evt-1",
    sessionId: "22222222-2222-4222-8222-222222222222",
    projectId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-06T11:50:00.000Z",
    sourceKind: "command",
    label: "grep error src",
    rawBytes: 2000,
    returnedBytes: 500,
    bytesSaved: 1500,
    savingRatio: 0.75,
    summary: "3 kept",
    ...overrides,
  } as TokenSaverEvent;
}

describe("receiptsFromEvents", () => {
  it("keeps only command-source events", () => {
    const receipts = receiptsFromEvents([
      event({ childExitCode: 0 }),
      event({ id: "evt-2", sourceKind: "file" }),
    ]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.command).toBe("grep error src");
  });

  it("maps the exit-code tri-state: number, null=terminated, absent=unrecorded", () => {
    const [zero, killed, old] = receiptsFromEvents([
      event({ childExitCode: 0 }),
      event({ id: "evt-2", childExitCode: null }),
      event({ id: "evt-3" }),
    ]);
    expect(zero?.exit).toEqual({ kind: "code", code: 0 });
    expect(killed?.exit).toEqual({ kind: "terminated" });
    expect(old?.exit).toEqual({ kind: "unrecorded" });
  });

  it("carries chunkSetId only when the event has one (exactOptionalPropertyTypes)", () => {
    const [withChunks, without] = receiptsFromEvents([
      event({ chunkSetId: "cs-abc" }),
      event({ id: "evt-2" }),
    ]);
    expect(withChunks?.chunkSetId).toBe("cs-abc");
    expect(without !== undefined && "chunkSetId" in without).toBe(false);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — module not found.
- [ ] **Step 3: Implement**

```typescript
import type { TokenSaverEvent } from "@megasaver/core";

export type ReceiptExit =
  | { kind: "code"; code: number }
  | { kind: "terminated" }
  | { kind: "unrecorded" };

export type VerificationReceipt = {
  command: string; // event.label — redacted at the source before persist
  exit: ReceiptExit;
  recordedAt: string;
  sessionId: string;
  chunkSetId?: string;
};

function exitOf(childExitCode: number | null | undefined): ReceiptExit {
  if (childExitCode === undefined) return { kind: "unrecorded" };
  if (childExitCode === null) return { kind: "terminated" };
  return { kind: "code", code: childExitCode };
}

export function receiptsFromEvents(events: readonly TokenSaverEvent[]): VerificationReceipt[] {
  const receipts: VerificationReceipt[] = [];
  for (const event of events) {
    if (event.sourceKind !== "command") continue;
    receipts.push({
      command: event.label,
      exit: exitOf(event.childExitCode),
      recordedAt: event.createdAt,
      sessionId: event.sessionId,
      ...(event.chunkSetId !== undefined ? { chunkSetId: event.chunkSetId } : {}),
    });
  }
  return receipts;
}
```

- [ ] **Step 4: Run and pass**, then **Commit** — `feat(cli): receipt view over exec events`

---

### Task 5: Join engine — claims × receipts × window

**Files:**
- Create: `apps/cli/src/commands/verify/join.ts`
- Test: `apps/cli/test/verify/join.test.ts` (new)

**Interfaces:**
- `export type ClaimVerdict = "verified" | "exit-mismatch" | "exit-unrecorded" | "no-receipt"`
- `export type VerifiedClaim = { claim: DetectedClaim; receipt: VerificationReceipt | undefined; verdict: ClaimVerdict }`
- `export type JoinResult = { rows: VerifiedClaim[]; considered: VerificationReceipt[] }`
- `export function joinClaimsToReceipts(input: { claims: readonly DetectedClaim[]; receipts: readonly VerificationReceipt[]; now: string; windowMinutes: number }): JoinResult`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { joinClaimsToReceipts } from "../../src/commands/verify/join.js";
import type { VerificationReceipt } from "../../src/commands/verify/receipts.js";

const NOW = "2026-08-06T12:00:00.000Z";
const CLAIM = { patternId: "tests-pass", excerpt: "tests pass", index: 0 };

function receipt(recordedAt: string, exit: VerificationReceipt["exit"]): VerificationReceipt {
  return {
    command: "grep error",
    exit,
    recordedAt,
    sessionId: "22222222-2222-4222-8222-222222222222",
  };
}

describe("joinClaimsToReceipts", () => {
  it("verdicts verified on a clean in-window receipt", () => {
    const { rows, considered } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:45:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("verified");
    expect(considered).toHaveLength(1);
  });

  it("excludes receipts outside the window — no-receipt", () => {
    const { rows, considered } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:00:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("no-receipt");
    expect(rows[0]?.receipt).toBeUndefined();
    expect(considered).toHaveLength(0);
  });

  it("the NEWEST in-window receipt wins the join", () => {
    const { rows } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [
        receipt("2026-08-06T11:40:00.000Z", { kind: "code", code: 0 }),
        receipt("2026-08-06T11:55:00.000Z", { kind: "code", code: 2 }),
      ],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("exit-mismatch");
  });

  it("terminated is a mismatch; unrecorded is its own verdict, never verified", () => {
    const killed = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:55:00.000Z", { kind: "terminated" })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(killed.rows[0]?.verdict).toBe("exit-mismatch");

    const preC3 = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:55:00.000Z", { kind: "unrecorded" })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(preC3.rows[0]?.verdict).toBe("exit-unrecorded");
  });

  it("the exact window edge is inclusive", () => {
    const { rows } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:30:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("verified");
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — module not found.
- [ ] **Step 3: Implement**

```typescript
import type { DetectedClaim } from "./claim-patterns.js";
import type { VerificationReceipt } from "./receipts.js";

export type ClaimVerdict = "verified" | "exit-mismatch" | "exit-unrecorded" | "no-receipt";

export type VerifiedClaim = {
  claim: DetectedClaim;
  receipt: VerificationReceipt | undefined;
  verdict: ClaimVerdict;
};

export type JoinResult = { rows: VerifiedClaim[]; considered: VerificationReceipt[] };

function verdictOf(receipt: VerificationReceipt | undefined): ClaimVerdict {
  if (receipt === undefined) return "no-receipt";
  switch (receipt.exit.kind) {
    case "code":
      return receipt.exit.code === 0 ? "verified" : "exit-mismatch";
    case "terminated":
      return "exit-mismatch";
    case "unrecorded":
      return "exit-unrecorded";
  }
}

export function joinClaimsToReceipts(input: {
  claims: readonly DetectedClaim[];
  receipts: readonly VerificationReceipt[];
  now: string;
  windowMinutes: number;
}): JoinResult {
  const floorMs = Date.parse(input.now) - input.windowMinutes * 60_000;
  const considered = input.receipts
    .filter((receipt) => {
      const ts = Date.parse(receipt.recordedAt);
      return Number.isFinite(ts) && ts >= floorMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const newest = considered[considered.length - 1];
  const rows = input.claims.map((claim) => ({
    claim,
    receipt: newest,
    verdict: verdictOf(newest),
  }));
  return { rows, considered };
}
```

- [ ] **Step 4: Run and pass**, then **Commit** — `feat(cli): join claims to receipts in a window`

---

### Task 6: `mega verify claims` command

**Files:**
- Create: `apps/cli/src/commands/verify/claims.ts` (`runVerifyClaims` + `verifyClaimsCommand` + `formatClaimLines`)
- Create: `apps/cli/src/commands/verify/index.ts` (`verifyCommand` parent)
- Modify: `apps/cli/src/main.ts` (add `verify: verifyCommand` to `subCommands`, `main.ts:60`)
- Modify: `apps/cli/src/errors.ts` (four new helpers)
- Test: `apps/cli/test/verify/claims-command.test.ts` (new)

**Interfaces:**

```typescript
export type RunVerifyClaimsInput = {
  sessionFlag: string | undefined;
  fileFlag: string | undefined;
  windowFlag: string | undefined;
  strict: boolean;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runVerifyClaims(input: RunVerifyClaimsInput): Promise<0 | 1>;
export function formatClaimLines(rows: readonly VerifiedClaim[]): string[];
export const DEFAULT_WINDOW_MINUTES = 30;
```

New `apps/cli/src/errors.ts` helpers (same `CliMessage` shape as `intentRequiredMessage`, `errors.ts:300`):

```typescript
export function claimsInputRequiredMessage(): CliMessage {
  return { message: "error: claims_input_required: pipe text or pass --file <path>", exitCode: 1 };
}
export function claimsInputTooLargeMessage(maxBytes: number): CliMessage {
  return { message: `error: claims_input_too_large: input exceeds ${maxBytes} bytes`, exitCode: 1 };
}
export function invalidWindowMessage(value: string): CliMessage {
  return { message: `error: invalid window "${value}" (integer minutes, 1..1440)`, exitCode: 1 };
}
export function strictRequiresSessionMessage(): CliMessage {
  return { message: "error: --strict requires --session", exitCode: 1 };
}
```

- [ ] **Step 1: Write the failing CLI tests** (store seeding per `apps/cli/test/audit.test.ts:44-52` + `apps/cli/test/audit/session-overlay.test.ts:79-87`; all stats symbols via `@megasaver/core`):

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type TokenSaverEvent,
  appendEvent,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVerifyClaims } from "../../src/commands/verify/claims.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-06T11:50:00.000Z";
const NOW = "2026-08-06T12:00:00.000Z";

let root: string;
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-verify-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedSession(): Promise<void> {
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo session",
    startedAt: TS,
    endedAt: null,
  } as never);
}

function seedReceipt(overrides: Partial<TokenSaverEvent>): void {
  appendEvent({
    store: { root },
    event: {
      id: "evt-1",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: TS,
      sourceKind: "command",
      label: "grep error src",
      rawBytes: 2000,
      returnedBytes: 500,
      bytesSaved: 1500,
      savingRatio: 0.75,
      summary: "3 kept",
      childExitCode: 0,
      ...overrides,
    } as TokenSaverEvent,
    secretsRedacted: 0,
    chunksStored: 1,
  });
}

function baseInput() {
  return {
    sessionFlag: SESSION_ID,
    fileFlag: undefined,
    windowFlag: undefined,
    strict: false,
    json: false,
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined,
    stdinIsTty: false,
    readStdin: async () => "All tests pass and the build is green.",
    now: () => NOW,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe("mega verify claims", () => {
  it("reports VERIFIED when a clean in-window receipt exists", async () => {
    await seedSession();
    seedReceipt({});
    const code = await runVerifyClaims(baseInput());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("VERIFIED");
    expect(out.join("\n")).toContain("grep error src");
  });

  it("reports NO-RECEIPT and fails --strict when the store is empty", async () => {
    await seedSession();
    const code = await runVerifyClaims({ ...baseInput(), strict: true });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("NO-RECEIPT");
  });

  it("highlights an exit mismatch", async () => {
    await seedSession();
    seedReceipt({ childExitCode: 2 });
    const code = await runVerifyClaims(baseInput());
    expect(code).toBe(0); // report-only without --strict
    expect(out.join("\n")).toContain("EXIT-MISMATCH");
  });

  it("--json emits one JSON document with the closed verdict union", async () => {
    await seedSession();
    seedReceipt({});
    const code = await runVerifyClaims({ ...baseInput(), json: true });
    expect(code).toBe(0);
    const doc = JSON.parse(out.join("\n")) as {
      sessionId: string;
      windowMinutes: number;
      claims: { patternId: string; verdict: string }[];
      receiptsConsidered: unknown[];
    };
    expect(doc.sessionId).toBe(SESSION_ID);
    expect(doc.windowMinutes).toBe(30);
    expect(doc.claims.every((c) => c.verdict === "verified")).toBe(true);
    expect(doc.receiptsConsidered).toHaveLength(1);
  });

  it("detection-only without --session lists claims and no verdicts", async () => {
    const code = await runVerifyClaims({ ...baseInput(), sessionFlag: undefined, json: true });
    expect(code).toBe(0);
    const doc = JSON.parse(out.join("\n")) as { sessionId: null; claims: unknown[] };
    expect(doc.sessionId).toBeNull();
    expect(doc.claims.length).toBeGreaterThan(0);
  });

  it("failure paths: TTY with no --file, --strict without --session, bad --window", async () => {
    const noInput = await runVerifyClaims({ ...baseInput(), stdinIsTty: true });
    expect(noInput).toBe(1);
    expect(err.join("\n")).toContain("claims_input_required");
    expect(out).toHaveLength(0);

    err.length = 0;
    const strictNoSession = await runVerifyClaims({
      ...baseInput(),
      sessionFlag: undefined,
      strict: true,
    });
    expect(strictNoSession).toBe(1);
    expect(err.join("\n")).toContain("--strict requires --session");

    err.length = 0;
    const badWindow = await runVerifyClaims({ ...baseInput(), windowFlag: "0" });
    expect(badWindow).toBe(1);
    expect(err.join("\n")).toContain("invalid window");
  });

  it("unknown session id exits 1 on stderr only", async () => {
    await seedSession();
    const code = await runVerifyClaims({
      ...baseInput(),
      sessionFlag: "99999999-9999-4999-8999-999999999999",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("not found");
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — module not found.
- [ ] **Step 3: Implement `runVerifyClaims`** (thin-adapter shape per `wiki/workflows/cli-test-pattern` and `apps/cli/src/commands/output/exec.ts`):

```typescript
import { readFile } from "node:fs/promises";
import { readEvents } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  claimsInputRequiredMessage,
  claimsInputTooLargeMessage,
  fileReadFailedMessage,
  invalidWindowMessage,
  mapErrorToCliMessage,
  sessionNotFoundMessage,
  strictRequiresSessionMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { MAX_CLAIMS_INPUT_BYTES, scanClaims } from "./claim-patterns.js";
import { type VerifiedClaim, joinClaimsToReceipts } from "./join.js";
import { type ReceiptExit, receiptsFromEvents } from "./receipts.js";

export const DEFAULT_WINDOW_MINUTES = 30;

function renderExit(exit: ReceiptExit): string {
  switch (exit.kind) {
    case "code":
      return `exit ${exit.code}`;
    case "terminated":
      return "terminated";
    case "unrecorded":
      return "exit unrecorded";
  }
}

export function formatClaimLines(rows: readonly VerifiedClaim[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(
      `${row.verdict.toUpperCase().padEnd(16)}${row.claim.patternId.padEnd(15)}"${row.claim.excerpt}"`,
    );
    if (row.receipt !== undefined) {
      lines.push(
        `    receipt: ${row.receipt.command}  ${renderExit(row.receipt.exit)}  ${row.receipt.recordedAt}`,
      );
    }
  }
  return lines;
}
```

Body of `runVerifyClaims` (each early exit: message → `input.stderr`, return `cli.exitCode` — the `runFailRecord` shape, `apps/cli/src/commands/fail/record.ts:31`):

```typescript
export async function runVerifyClaims(input: RunVerifyClaimsInput): Promise<0 | 1> {
  const fail = (cli: CliMessage): 1 => {
    input.stderr(cli.message);
    return cli.exitCode;
  };

  if (input.strict && input.sessionFlag === undefined) {
    return fail(strictRequiresSessionMessage());
  }

  let windowMinutes = DEFAULT_WINDOW_MINUTES;
  if (input.windowFlag !== undefined) {
    const parsed = Number(input.windowFlag);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
      return fail(invalidWindowMessage(input.windowFlag));
    }
    windowMinutes = parsed;
  }

  let text: string;
  if (input.fileFlag !== undefined) {
    try {
      text = await readFile(input.fileFlag, "utf8");
    } catch (err) {
      return fail(fileReadFailedMessage(err instanceof Error ? err.message : String(err)));
    }
  } else if (!input.stdinIsTty) {
    text = await input.readStdin();
  } else {
    return fail(claimsInputRequiredMessage());
  }
  if (Buffer.byteLength(text, "utf8") > MAX_CLAIMS_INPUT_BYTES) {
    return fail(claimsInputTooLargeMessage(MAX_CLAIMS_INPUT_BYTES));
  }

  const claims = scanClaims(text);

  if (input.sessionFlag === undefined) {
    // Detection-only (spec Locked Decision 4): claims listed, no verdicts.
    if (input.json) {
      input.stdout(
        JSON.stringify({ sessionId: null, windowMinutes: null, claims, receiptsConsidered: [] }),
      );
    } else {
      input.stdout(`claims: ${claims.length} (detection only — no --session)`);
      for (const claim of claims) {
        input.stdout(`  ${claim.patternId.padEnd(15)}"${claim.excerpt}"`);
      }
    }
    return 0;
  }

  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    return fail(mapErrorToCliMessage(err, { kind: "store" }));
  }

  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionFlag);
  } catch (err) {
    return fail(mapErrorToCliMessage(err, { kind: "sessionId" }));
  }

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const session = registry.getSession(sessionId);
    if (session === null) return fail(sessionNotFoundMessage(sessionId));

    const events = readEvents({ root: rootDir }, session.projectId, sessionId);
    const receipts = receiptsFromEvents(events);
    const now = (input.now ?? (() => new Date().toISOString()))();
    const { rows, considered } = joinClaimsToReceipts({ claims, receipts, now, windowMinutes });

    if (input.json) {
      input.stdout(
        JSON.stringify({
          sessionId,
          windowMinutes,
          claims: rows.map(({ claim, verdict, receipt }) => ({
            ...claim,
            verdict,
            receipt: receipt ?? null,
          })),
          receiptsConsidered: considered,
        }),
      );
    } else if (rows.length === 0) {
      input.stdout("no claims detected");
    } else {
      input.stdout(`claims: ${rows.length}  receipts in window: ${considered.length}`);
      for (const line of formatClaimLines(rows)) input.stdout(line);
    }

    // Documented JSON-policy exception (connector-status precedent): the report
    // is already printed; --strict only flips the exit code on missing or
    // contradicting evidence.
    const gateFails = rows.some(
      (row) => row.verdict === "no-receipt" || row.verdict === "exit-mismatch",
    );
    return input.strict && gateFails ? 1 : 0;
  } catch (err) {
    return fail(mapErrorToCliMessage(err));
  }
}
```

(`CliMessage` joins the existing type-only import from `../../errors.js`.)

`verifyClaimsCommand` (citty wrapper — spreads `readStoreEnv` exactly like `outputExecCommand`, `apps/cli/src/commands/output/exec.ts:214`):

```typescript
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export const verifyClaimsCommand = defineCommand({
  meta: {
    name: "claims",
    description: "Scan text for success claims and join them to exec receipts.",
  },
  args: {
    session: { type: "string", description: "Session id (UUID) whose receipts to join." },
    file: { type: "string", description: "Read the text from a file instead of stdin." },
    window: { type: "string", description: "Receipt window in minutes (1..1440, default 30)." },
    strict: {
      type: "boolean",
      default: false,
      description: "Exit 1 on any no-receipt or exit-mismatch verdict.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runVerifyClaims({
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      fileFlag: typeof args.file === "string" ? args.file : undefined,
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      strict: !!args.strict,
      json: !!args.json,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdinIsTty: process.stdin.isTTY === true,
      readStdin: readAllStdin,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

`apps/cli/src/commands/verify/index.ts`:

```typescript
import { defineCommand } from "citty";
import { verifyClaimsCommand } from "./claims.js";

export const verifyCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Claim-verification gate: join success claims to exec receipts.",
  },
  subCommands: { claims: verifyClaimsCommand },
});
```

Register in `apps/cli/src/main.ts` `subCommands` (alphabetical-ish block at `:60`): `verify: verifyCommand`.

- [ ] **Step 4: Run and pass** — `pnpm --filter @megasaver/cli test -- verify`, plus `pnpm --filter @megasaver/cli typecheck`.
- [ ] **Step 5: Commit** — `feat(cli): mega verify claims joins claims to receipts`

---

### Task 7: Opt-in Stop-hook reminder

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts` (event union at `:324`, settings shape near `:210`; new Stop helpers mirroring `hasSessionStartHook`/`addSessionStartHook` at `:413`/`:421`; `buildHookCommand` subcommand union at `:35` gains `"verify-reminder"`)
- Modify: `packages/connectors/claude-code/src/index.ts` (export `hasStopHook`/`addStopHook`/`removeStopHook` and `writeSettingsFile` — the settings-write single-writer, currently internal; its own header comment requires every settings mutation to go through it)
- Create: `apps/cli/src/hooks/verify-reminder-run.ts`
- Create: `apps/cli/src/commands/hooks/verify-reminder.ts`; register in `apps/cli/src/commands/hooks/index.ts` `subCommands`
- Create: `apps/cli/src/commands/verify/enable-hook.ts` (`runVerifyHookToggle` + both `verifyEnableHookCommand` and `verifyDisableHookCommand`); register in `apps/cli/src/commands/verify/index.ts`
- Test: `packages/connectors/claude-code/test/stop-hook.test.ts` (new)
- Test: `apps/cli/test/hooks/verify-reminder.test.ts` (new)
- Test: `apps/cli/test/verify/enable-hook.test.ts` (new)

**Interfaces:**
- `export function hasStopHook(settings: unknown, command: string): boolean` (connector)
- `export function addStopHook(settings: unknown, command: string): SettingsObject` (connector; like SessionStart, Stop takes NO matcher)
- `export function removeStopHook(settings: unknown, command: string): SettingsObject` (connector; command-level strip — a co-located foreign hook in the same entry survives, PR #141 discipline)
- `export function runVerifyHookToggle(input: { action: "enable" | "disable"; settingsPath: string; command: string; json: boolean; stdout: (line: string) => void; stderr: (line: string) => void }): 0 | 1` (cli, testable seam under both citty wrappers)
- `export const VERIFY_REMINDER_WINDOW_MINUTES = 30` (cli)
- `export function buildVerifyReminder(input: { events: readonly OverlayTokenSaverEvent[]; nowMs: number; windowMinutes: number }): string | undefined` (cli, pure)
- `export async function runVerifyReminderHookFromProcess(deps: { storeRoot: string; stdin: () => Promise<string>; stdout: (line: string) => void; nowMs?: () => number }): Promise<0>` (cli)

- [ ] **Step 1: Write the failing connector tests** — `stop-hook.test.ts`: `addStopHook` on empty settings creates `hooks.Stop` with the command and NO matcher field; `addStopHook` is idempotent (`hasStopHook` true → unchanged); `removeStopHook` strips only the owned command and preserves a foreign hook co-located in the same Stop entry — mirror the fixture shape of the existing uninstall strip test at `packages/connectors/claude-code/test/hook-settings.test.ts:144` ("uninstall strips only the Mega Saver command from a shared entry, keeping co-located user hooks"; if it has moved, `grep -n "co-located" packages/connectors/claude-code/test/hook-settings.test.ts` finds it).
- [ ] **Step 2: Run and observe the expected failure**, then implement the three helpers by mirroring the SessionStart pair (`hook-settings.ts:413`/`:421`; extend the internal event-key union at `:324` and the `SettingsObject` `hooks` field near `:210` with `Stop`; extend `buildHookCommand`'s subcommand union at `:35` with `"verify-reminder"` — the hyphenated-subcommand path is already proven by `"cache-advice"`). Export `hasStopHook`/`addStopHook`/`removeStopHook` and `writeSettingsFile` from `packages/connectors/claude-code/src/index.ts` (§8: cross-package import only through the public entry). Run and pass — `pnpm --filter @megasaver/connector-claude-code test`.
- [ ] **Step 3: Write the failing hook-handler tests** — `apps/cli/test/hooks/verify-reminder.test.ts`. Seed overlay receipts by writing the JSONL directly (layout `stats/<workspaceKey>/<liveSessionId>.events.jsonl`, [[entities/stats]]); `workspaceKey` MUST come from the same `encodeWorkspaceKey` (`packages/shared/src/workspace-key.ts:20`) the payload `cwd` maps to:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildVerifyReminder,
  runVerifyReminderHookFromProcess,
} from "../../src/hooks/verify-reminder-run.js";

const LSID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");

let store: string;
let cwd: string;
const out: string[] = [];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-cwd-"));
  out.length = 0;
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function seedOverlayReceipt(createdAt: string): void {
  const wk = encodeWorkspaceKey(cwd);
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  const row = {
    id: "evt-1",
    liveSessionId: LSID,
    workspaceKey: wk,
    createdAt,
    sourceKind: "command",
    label: "grep error",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    childExitCode: 0,
  };
  writeFileSync(join(dir, `${LSID}.events.jsonl`), `${JSON.stringify(row)}\n`);
}

describe("verify-reminder Stop hook", () => {
  it("stays silent when an in-window exec receipt exists", async () => {
    seedOverlayReceipt("2026-08-06T11:50:00.000Z");
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => JSON.stringify({ session_id: LSID, cwd }),
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("emits a warn-only additionalContext reminder when no receipt exists", async () => {
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => JSON.stringify({ session_id: LSID, cwd }),
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    const doc = JSON.parse(out[0] ?? "{}") as {
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
      decision?: string;
    };
    expect(doc.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(doc.hookSpecificOutput?.additionalContext).toContain("mega output exec");
    expect(doc.decision).toBeUndefined(); // NEVER blocking
  });

  it("fails open: malformed stdin prints nothing and still returns 0", async () => {
    const code = await runVerifyReminderHookFromProcess({
      storeRoot: store,
      stdin: async () => "not json",
      stdout: (line) => out.push(line),
      nowMs: () => NOW_MS,
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("buildVerifyReminder ignores out-of-window and non-command events", () => {
    seedOverlayReceipt("2026-08-06T10:00:00.000Z"); // seeds the file; assert via pure fn
    const reminder = buildVerifyReminder({
      events: [
        {
          sourceKind: "command",
          createdAt: "2026-08-06T10:00:00.000Z",
        } as never,
        { sourceKind: "file", createdAt: "2026-08-06T11:59:00.000Z" } as never,
      ],
      nowMs: NOW_MS,
      windowMinutes: 30,
    });
    expect(reminder).toBeDefined();
  });
});
```

- [ ] **Step 4: Run and observe the expected failure**, then implement `apps/cli/src/hooks/verify-reminder-run.ts` (fail-open discipline of `intent-run.ts`):

```typescript
import { type OverlayTokenSaverEvent, readOverlayEvents } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";

export const VERIFY_REMINDER_WINDOW_MINUTES = 30;

const REMINDER =
  "Mega Saver: no exec receipt (command + exit code) was recorded for this session in the " +
  "last 30 minutes. If you claimed test/build results, run the check through `mega output " +
  "exec` or MCP proxy_run_command so the claim carries a receipt (`mega verify claims`).";

export function buildVerifyReminder(input: {
  events: readonly OverlayTokenSaverEvent[];
  nowMs: number;
  windowMinutes: number;
}): string | undefined {
  const floor = input.nowMs - input.windowMinutes * 60_000;
  const hasReceipt = input.events.some((event) => {
    if (event.sourceKind !== "command") return false;
    const ts = Date.parse(event.createdAt);
    return Number.isFinite(ts) && ts >= floor;
  });
  return hasReceipt ? undefined : REMINDER;
}

export async function runVerifyReminderHookFromProcess(deps: {
  storeRoot: string;
  stdin: () => Promise<string>;
  stdout: (line: string) => void;
  nowMs?: () => number;
}): Promise<0> {
  try {
    const payload = JSON.parse(await deps.stdin()) as { session_id?: string; cwd?: string };
    if (typeof payload.session_id !== "string" || payload.session_id === "") return 0;
    // ASSUMPTION (spec Open questions): the Stop payload carries cwd; Claude
    // Code runs hook commands in the project directory, so process.cwd() is
    // the honest fallback.
    const cwd = typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
    const events = readOverlayEvents(
      { root: deps.storeRoot },
      encodeWorkspaceKey(cwd),
      payload.session_id,
    );
    const reminder = buildVerifyReminder({
      events,
      nowMs: (deps.nowMs ?? Date.now)(),
      windowMinutes: VERIFY_REMINDER_WINDOW_MINUTES,
    });
    if (reminder !== undefined) {
      // ASSUMPTION (spec Open questions): Claude Code accepts
      // hookSpecificOutput.additionalContext on Stop; if verification at impl
      // time says otherwise, fall back to { systemMessage: reminder }.
      // Warn-only either way — NEVER decision:"block".
      deps.stdout(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop", additionalContext: reminder },
        }),
      );
    }
  } catch {
    // fail-open: a reminder must never break the session's Stop.
  }
  return 0;
}
```

- [ ] **Step 5: Write the failing toggle tests, then wire the commands.**

First the failing test — `apps/cli/test/verify/enable-hook.test.ts` exercises the settings writes through `runVerifyHookToggle` (the citty wrappers stay thin):

```typescript
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVerifyHookToggle } from "../../src/commands/verify/enable-hook.js";

const CMD = "mega hooks verify-reminder";

let dir: string;
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-toggle-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function toggle(action: "enable" | "disable"): 0 | 1 {
  return runVerifyHookToggle({
    action,
    settingsPath: join(dir, "settings.json"),
    command: CMD,
    json: false,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
}

describe("mega verify enable-hook / disable-hook", () => {
  it("enable writes a Stop entry with the reminder command and no matcher", () => {
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["enabled"]);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as {
      hooks: { Stop: { matcher?: string; hooks: { command: string }[] }[] };
    };
    const entry = settings.hooks.Stop[0];
    expect(entry?.hooks[0]?.command).toBe(CMD);
    expect(entry !== undefined && "matcher" in entry).toBe(false);
  });

  it("enable is idempotent; disable strips; disable again reports not installed", () => {
    toggle("enable");
    const before = readFileSync(join(dir, "settings.json"), "utf8");
    out.length = 0;
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["already enabled"]);
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(before);

    out.length = 0;
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["disabled"]);
    // Clean uninstall leaves no residue (pruneHooks round-trip precedent).
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toEqual({});

    out.length = 0;
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["not installed"]);
  });

  it("disable on a missing settings file reports not installed and creates nothing", () => {
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["not installed"]);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });
});
```

`apps/cli/src/commands/hooks/verify-reminder.ts` (thin wrapper, `hooksIntentCommand` shape):

```typescript
import { defineCommand } from "citty";
import { runVerifyReminderHookFromProcess } from "../../hooks/verify-reminder-run.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// The command Claude Code's Stop hook invokes. SAFETY: ALWAYS exits 0; prints
// nothing on any error — a reminder must never break the session's Stop.
// Wired by `mega verify enable-hook`, not run by hand.
export const hooksVerifyReminderCommand = defineCommand({
  meta: {
    name: "verify-reminder",
    description: "Internal: remind a stopping session that no exec receipt exists (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
    } catch {
      return; // fail-open: no resolvable store, no reminder, exit 0
    }
    await runVerifyReminderHookFromProcess({
      storeRoot,
      stdin: readAllStdin,
      stdout: (line) => console.log(line),
    });
  },
});
```

Register as `"verify-reminder": hooksVerifyReminderCommand` in `apps/cli/src/commands/hooks/index.ts` `subCommands`.

`apps/cli/src/commands/verify/enable-hook.ts` — the settings write goes through the connector's `writeSettingsFile` (atomic tmp + fsync + rename, symlink-refusing, mode-preserving; the connector's single-writer discipline), and the `<cmd>` string is built by the SAME `buildHookCommand` (`packages/connectors/claude-code/src/hook-settings.ts:34`) with the SAME E23 cliPath / E29 store-bake resolution `hooks install` uses (`resolveInvokedCliPath`/`resolveBakedStoreRoot`, `apps/cli/src/commands/hooks/install.ts:31`/`:44`) — do not invent a second format:

```typescript
import { existsSync, readFileSync } from "node:fs";
import {
  type HookCommandConfig,
  addStopHook,
  buildHookCommand,
  hasStopHook,
  removeStopHook,
  writeSettingsFile,
} from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { resolveBakedStoreRoot, resolveInvokedCliPath } from "../hooks/install.js";
import { resolveClaudeCodeSettingsPath } from "../hooks/settings-path.js";

export function runVerifyHookToggle(input: {
  action: "enable" | "disable";
  settingsPath: string;
  command: string;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}): 0 | 1 {
  let settings: unknown = {};
  try {
    if (existsSync(input.settingsPath)) {
      settings = JSON.parse(readFileSync(input.settingsPath, "utf8"));
    }
  } catch (err) {
    input.stderr(
      `error: could not read ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  const installed = hasStopHook(settings, input.command);
  const status =
    input.action === "enable"
      ? installed
        ? "already enabled"
        : "enabled"
      : installed
        ? "disabled"
        : "not installed";
  try {
    if (input.action === "enable" && !installed) {
      writeSettingsFile(input.settingsPath, addStopHook(settings, input.command));
    } else if (input.action === "disable" && installed) {
      writeSettingsFile(input.settingsPath, removeStopHook(settings, input.command));
    }
  } catch (err) {
    input.stderr(
      `error: could not write ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  input.stdout(
    input.json ? JSON.stringify({ settingsPath: input.settingsPath, status }) : status,
  );
  return 0;
}

function reminderHookCommand(storeFlag: string | undefined): string {
  const cliPath = resolveInvokedCliPath(process.argv[1]);
  const storeRoot = resolveBakedStoreRoot(readStoreEnv(storeFlag));
  const config: HookCommandConfig = {
    ...(cliPath !== undefined ? { cliPath } : {}),
    ...(storeRoot !== undefined ? { storeRoot } : {}),
  };
  return buildHookCommand("verify-reminder", config);
}

const toggleArgs = {
  settings: { type: "string", description: "Override Claude Code settings.json path." },
  store: {
    type: "string",
    description: "Override store directory (baked into the hook command when non-default).",
  },
  json: { type: "boolean", default: false, description: "Emit JSON output." },
} as const;

export const verifyEnableHookCommand = defineCommand({
  meta: { name: "enable-hook", description: "Opt in to the Stop-hook receipt reminder." },
  args: toggleArgs,
  run({ args }) {
    const code = runVerifyHookToggle({
      action: "enable",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      command: reminderHookCommand(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const verifyDisableHookCommand = defineCommand({
  meta: { name: "disable-hook", description: "Remove the Stop-hook receipt reminder." },
  args: toggleArgs,
  run({ args }) {
    const code = runVerifyHookToggle({
      action: "disable",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      command: reminderHookCommand(typeof args.store === "string" ? args.store : undefined),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Register in `apps/cli/src/commands/verify/index.ts` `subCommands`: `"enable-hook": verifyEnableHookCommand, "disable-hook": verifyDisableHookCommand`. Removal keys on the subcommand (`hookCommandMatches`), so `disable-hook` strips an entry installed under a different cliPath/store bake.
- [ ] **Step 6: Run and pass** — `pnpm --filter @megasaver/cli test -- verify-reminder`, `pnpm --filter @megasaver/cli test -- enable-hook`, `pnpm --filter @megasaver/connector-claude-code test`, `pnpm --filter @megasaver/cli typecheck`.
- [ ] **Step 7: Commit** — `feat(cli): opt-in stop-hook receipt reminder`

---

### Task 8: Changeset, full verify, smoke evidence

**Files:**
- Create: `.changeset/claim-verification-gate.md`

- [ ] **Step 1: Changeset** (DoD #9 — public surfaces changed in four packages):

```markdown
---
"@megasaver/stats": minor
"@megasaver/context-gate": minor
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
---

Claim-Verification Gate: exec receipts now record the child exit code
(`childExitCode`, additive-optional on both token-saver event schemas);
new `mega verify claims` scans caller-provided text for success claims
and joins them to receipts in a time window (`--json`, `--strict`);
opt-in Stop-hook reminder via `mega verify enable-hook` (warn-only,
fail-open, off by default).
```

- [ ] **Step 2: `pnpm verify`** at the branch tip — lint + typecheck + full test suite green (includes `conventions:check`; no conventions were edited, so no drift expected).
- [ ] **Step 3: Smoke evidence** (DoD #5 — captured terminal session):

```bash
pnpm --filter @megasaver/cli build
STORE=$(mktemp -d)
node apps/cli/dist/cli.js project create demo --root "$PWD" --store "$STORE"
SID=$(node apps/cli/dist/cli.js session create demo --agent claude-code --store "$STORE")
node apps/cli/dist/cli.js output exec "$SID" --intent "smoke receipt" --store "$STORE" -- grep name package.json
echo "tests pass and the build is green" | node apps/cli/dist/cli.js verify claims --session "$SID" --store "$STORE"
echo "tests pass" | node apps/cli/dist/cli.js verify claims --session "$SID" --store "$STORE" --strict --json
```

Expected: the exec line prints a savings line (receipt recorded with exit 0), the first `verify claims` prints two `VERIFIED` rows against the `grep` receipt, the `--strict --json` run exits 0 with `"verdict":"verified"`. Then demonstrate the negative: a fresh session with no exec run → `NO-RECEIPT` + `--strict` exit 1. Capture both.

- [ ] **Step 4: Commit** — `chore: changeset for claim-verification gate`
- [ ] **Step 5: Review gates** — `code-reviewer` pass (spec risk MEDIUM), then `verifier` with the smoke capture (DoD #6/#7). Author and reviewer never the same active context.

---

## Self-review notes

- Every symbol referenced is either defined in a task above or proven present: `readEvents`/`readOverlayEvents`/`appendEvent`/`initStore`/`createJsonDirectoryCoreRegistry`/`TokenSaverEvent` (core re-exports, `packages/core/src/context-gate.ts:33-107`), `sessionIdSchema`/`encodeWorkspaceKey` (`@megasaver/shared`), `resolveStorePath`/`readStoreEnv`/`ensureStoreReady` (`apps/cli/src/store.ts`, used by `commands/output/exec.ts`), `mapErrorToCliMessage`/`sessionNotFoundMessage`/`fileReadFailedMessage` (`apps/cli/src/errors.ts`), `hasSessionStartHook`/`addSessionStartHook` (`packages/connectors/claude-code/src/hook-settings.ts:413/:421`), fake-child exec harness (`packages/context-gate/test/ledger-signed-delta.test.ts`), registry seeding (`apps/cli/test/audit.test.ts:44`, `apps/cli/test/audit/session-overlay.test.ts:79`).
- Both formerly grep-and-reuse pointers are now confirmed and cited directly: the uninstall strip fixture is `packages/connectors/claude-code/test/hook-settings.test.ts:144`, and the hook command-string builder is `buildHookCommand` (`packages/connectors/claude-code/src/hook-settings.ts:34`, subcommand union extended with `"verify-reminder"` in Task 7). Reusing them is mandatory, inventing parallels is forbidden.
- No timing-tight tests: Task 3 asserts a growth ratio with min-per-size sampling and calibrated repeats; no absolute wall-clock ceiling, no runtime lower bound.
