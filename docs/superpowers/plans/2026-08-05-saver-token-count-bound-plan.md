# Saver Token-Count Bound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give token measurement on the saver hot path a real, deterministic bound, replacing a 500 ms timer that cannot fire.

**Architecture:** `countTokens` gains two size caps and returns `null` above them, meaning "deliberately not measured". `CHUNK_SIZE` drops 1000 → 250 so more repetitive input fits under the cap. The existing `Promise.race` in `record-output.ts` is kept but renamed and re-documented, because it genuinely bounds the async encoding load — it only ever falsely claimed to bound the synchronous encode.

**Tech Stack:** TypeScript strict ESM, Vitest, pnpm workspaces, js-tiktoken (`cl100k_base`).

**Spec:** `docs/superpowers/specs/2026-08-05-saver-token-count-bound-design.md`

## Global Constraints

- Stall ceiling for one tool call: **1500 ms**, matching `DAEMON_TIMEOUT_MS` in `apps/cli/src/hooks/saver-run.ts:102`.
- `MAX_REPETITIVE_CHARS = 32_768` (chunked path, worst measured 13.16 µs/char, predicted 431 ms).
- `MAX_MEASURABLE_CHARS = 2_097_152` (whole-string path, worst measured 0.14 µs/char, predicted 294 ms).
- `CHUNK_SIZE = 250`. `MAX_SAFE_RUN` stays `2000`.
- **Do not replace `longestRun`.** A same-character-run detector was measured and refuted (spec §3.1): periods 2–16 are seconds-slow at 10 KB and carry a same-character run of zero.
- A capped row omits `rawTokens`, `returnedTokens` and `deltaTokens` entirely. Never zero, never an estimate — "a value in a field named `rawTokens` is measured or absent".
- Timing assertions are **ratio-based**, never absolute wall-clock, so they survive slower CI hardware.
- Caps are checked **before** `await loadEncoding()`, so input that will not be measured never pays the multi-MB ranks load.

---

### Task 1: Caps and null return in `countTokens`

**Files:**
- Modify: `packages/output-filter/src/tokens.ts:64-93`
- Modify: `packages/context-gate/src/record-output.ts:99` and `:390-412` (type adaptation only — behavioural rewrite is Task 2)
- Modify: `packages/bench-replay/src/token-divergence.ts:22` (type adaptation only — exclusion semantics are Task 3)
- Test: `packages/output-filter/test/tokens.test.ts`

**Interfaces:**
- Produces: `countTokens(text: string): Promise<number | null>`; `MAX_REPETITIVE_CHARS: number`; `MAX_MEASURABLE_CHARS: number`. Both constants exported from `packages/output-filter/src/index.ts` alongside the existing `MAX_SAFE_RUN` export block.

- [ ] **Step 1: Write the failing tests**

Append to `packages/output-filter/test/tokens.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MAX_MEASURABLE_CHARS,
  MAX_REPETITIVE_CHARS,
  countTokens,
} from "../src/tokens.js";

const repeatTo = (unit: string, size: number): string =>
  unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

describe("countTokens size caps", () => {
  it("returns null for repetitive input above MAX_REPETITIVE_CHARS", async () => {
    const text = repeatTo("X", MAX_REPETITIVE_CHARS + 1);
    expect(await countTokens(text)).toBeNull();
  });

  it("returns null for any input above MAX_MEASURABLE_CHARS", async () => {
    const text = repeatTo("ordinary log line with spaces\n", MAX_MEASURABLE_CHARS + 1);
    expect(await countTokens(text)).toBeNull();
  });

  it("still measures repetitive input at exactly the cap", async () => {
    const text = repeatTo("X", MAX_REPETITIVE_CHARS);
    const n = await countTokens(text);
    expect(n).not.toBeNull();
    expect(n).toBeGreaterThan(0);
  });

  it("measures ordinary text far above the repetitive cap — the cap is for the chunked path only", async () => {
    const text = repeatTo("2026-08-05 INFO handled request in 42ms\n", 400_000);
    const n = await countTokens(text);
    expect(n).not.toBeNull();
    expect(n).toBeGreaterThan(0);
  });

  // Guards CHUNK_SIZE. Ratio, not wall-clock: period-16 is the worst measured
  // shape, varied hex the fastest that still takes the chunked path. At
  // CHUNK_SIZE 250 the observed ratio is ~74x; restoring 1000 pushes it ~4x
  // higher because per-chunk cost is quadratic in chunk size.
  it("keeps the worst repetitive shape within a bounded multiple of varied input", async () => {
    const size = MAX_REPETITIVE_CHARS;
    const varied = repeatTo("9f3a7c2e1b8d40567aef", size);
    const period16 = repeatTo("abcdefghijklmnop", size);
    await countTokens("warm the encoding");

    const t0 = performance.now();
    await countTokens(varied);
    const variedMs = Math.max(performance.now() - t0, 1);

    const t1 = performance.now();
    await countTokens(period16);
    const repetitiveMs = performance.now() - t1;

    expect(repetitiveMs / variedMs).toBeLessThan(150);
  });

  // Guards longestRun against replacement by a same-character detector, which
  // would route this shape to the whole-string path where 32 KB takes ~48 s.
  it("handles a period-8 shape quickly — it has no repeated character", { timeout: 5_000 }, async () => {
    const n = await countTokens(repeatTo("abcdefgh", MAX_REPETITIVE_CHARS));
    expect(n).not.toBeNull();
  });
});

// Spec §7's property, table-driven across every shape class measured during
// design. Each either completes or declines; none may exceed the ceiling AND
// return a number. Sizes straddle both caps.
const SHAPES: ReadonlyArray<{ name: string; unit: string }> = [
  { name: "ordinary log text", unit: "2026-08-05 INFO handled request in 42ms\n" },
  { name: "typescript source", unit: "export function foo(bar: string): number { return bar.length; }\n" },
  { name: "varied hex", unit: "9f3a7c2e1b8d40567aef" },
  { name: "minified json", unit: '{"a":1,"bb":22,"ccc":333,"dddd":4444},' },
  { name: "base64 blob", unit: "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q" },
  { name: "period 1", unit: "X" },
  { name: "period 2", unit: "ab" },
  { name: "period 3", unit: "abc" },
  { name: "period 8", unit: "abcdefgh" },
  { name: "period 16", unit: "abcdefghijklmnop" },
  { name: "random-ish", unit: "q7!Wz2#Lp9$Rt4%Yv6^Nb8&Mx0*Kc5" },
];

describe("countTokens bounds every measured shape class", () => {
  for (const shape of SHAPES) {
    for (const size of [MAX_REPETITIVE_CHARS, MAX_REPETITIVE_CHARS + 1]) {
      it(`${shape.name} at ${size} chars either completes or declines`, { timeout: 10_000 }, async () => {
        const result = await countTokens(repeatTo(shape.unit, size));
        if (result !== null) expect(result).toBeGreaterThan(0);
        // Reaching here at all is the assertion: a shape that blew the ceiling
        // would have tripped the 10 s timeout instead.
      });
    }
  }
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `pnpm --filter @megasaver/output-filter exec vitest run test/tokens.test.ts`
Expected: FAIL — `MAX_REPETITIVE_CHARS` and `MAX_MEASURABLE_CHARS` are not exported.

- [ ] **Step 3: Implement the caps**

Replace `packages/output-filter/src/tokens.ts:64-93` with:

```typescript
export const MAX_SAFE_RUN = 2000;
const CHUNK_SIZE = 250;

// Size caps, not time budgets. A time cutoff would make the same bytes
// measurable on a fast machine and omitted on a slow one, so two runs over
// identical input would store different events (I11 determinism). Each cap is
// the 1500 ms stall ceiling (matching DAEMON_TIMEOUT_MS in saver-run.ts,
// "a hung socket must not stall the hook") divided by the worst per-character
// rate measured for its path on 2026-08-05, with >=3x headroom:
//
//   chunked path      13.16 us/char (period-16, the worst shape measured —
//                     NOT "X".repeat, which is 38% cheaper) -> 431 ms at cap
//   whole-string path  0.14 us/char (ordinary log text)     -> 294 ms at cap
export const MAX_REPETITIVE_CHARS = 32_768;
export const MAX_MEASURABLE_CHARS = 2_097_152;

function longestRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // space, tab, LF, CR
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      if (current > longest) longest = current;
      current = 0;
    } else {
      current++;
    }
  }
  return current > longest ? current : longest;
}

// null means ABOVE THE CAP, deliberately not measured — never zero, never an
// estimate. Callers omit the token fields rather than substituting a value.
// Caps are checked before loadEncoding so input we will not measure never pays
// the multi-MB ranks load.
export async function countTokens(text: string): Promise<number | null> {
  if (text.length > MAX_MEASURABLE_CHARS) return null;
  const repetitive = longestRun(text) > MAX_SAFE_RUN;
  if (repetitive && text.length > MAX_REPETITIVE_CHARS) return null;

  const encoding = await loadEncoding();
  if (!repetitive) return encoding.encode(text).length;

  let total = 0;
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    total += encoding.encode(text.slice(i, i + CHUNK_SIZE)).length;
  }
  return total;
}
```

- [ ] **Step 4: Export the constants**

In `packages/output-filter/src/index.ts`, add `MAX_REPETITIVE_CHARS` and `MAX_MEASURABLE_CHARS` to the existing export block from `./tokens.js` (the one already listing `countTokens`, `estimateTokens`, `HARD_WRAP_THRESHOLD_TOKENS`, `PASSTHROUGH_THRESHOLD_TOKENS`, `FilterDecision`).

- [ ] **Step 5: Adapt the two callers so the tree typechecks**

In `packages/context-gate/src/record-output.ts:99`, change the seam type:

```typescript
  countTokensImpl?: (text: string) => Promise<number | null>;
```

In the same file, replace the assignment inside the `try` block (currently line 407):

```typescript
    if (rawTokens !== null && returnedTokens !== null) {
      tokenFields = { rawTokens, returnedTokens, deltaTokens: rawTokens - returnedTokens };
    }
```

In `packages/bench-replay/src/token-divergence.ts:22`, change the counter type:

```typescript
  count(text: string): Promise<number | null>;
```

and, in `measureTokenDivergence`, skip null for now (Task 3 makes the exclusion visible):

```typescript
    const realTokens = await counters.count(corpus.text);
    if (realTokens === null) continue;
```

In `packages/context-gate/test/record-output-tokens.test.ts:30`, the local
`runFixture` helper declares the same seam and must match or the test file will
not typecheck:

```typescript
  countTokensImpl?: (text: string) => Promise<number | null>;
```

- [ ] **Step 6: Run the tests, confirm they pass**

Run: `pnpm --filter @megasaver/output-filter exec vitest run test/tokens.test.ts`
Expected: PASS, all 6 new tests.

- [ ] **Step 7: Typecheck the three packages**

Run: `pnpm --filter @megasaver/output-filter --filter @megasaver/context-gate --filter @megasaver/bench-replay typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/output-filter/src/tokens.ts packages/output-filter/src/index.ts \
        packages/output-filter/test/tokens.test.ts \
        packages/context-gate/src/record-output.ts \
        packages/bench-replay/src/token-divergence.ts
git commit -m "fix(output-filter): cap token counting by input size"
```

---

### Task 2: Honest contract for the encoding-load timer

**Files:**
- Modify: `packages/context-gate/src/record-output.ts:76-85` and `:388-412`
- Test: `packages/context-gate/test/record-output-tokens.test.ts`

**Interfaces:**
- Consumes: `countTokens(text: string): Promise<number | null>` from Task 1.
- Produces: `ENCODING_LOAD_BUDGET_MS: number` replaces `TOKEN_COUNT_BUDGET_MS` (same 500 ms value). It is not in `packages/context-gate/src/index.ts`, so no package entry changes.

The race stays. It was never wrong about the load — `loadEncoding()` is genuinely async, so during it the event loop is free and the timer can fire. It was only wrong to claim it bounded the encode. Task 1's caps bound the encode; this task makes the constant say what it does.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("record-output measured tokens", …)` block in
`packages/context-gate/test/record-output-tokens.test.ts`, reusing the file's
own `runFixture` helper and `LARGE_RAW` fixture:

```typescript
  it("omits token fields when the counter declines, without zero-filling", async () => {
    const { event } = await runFixture({
      raw: LARGE_RAW,
      countTokensImpl: async () => null,
    });

    expect(event).not.toHaveProperty("rawTokens");
    expect(event).not.toHaveProperty("returnedTokens");
    expect(event).not.toHaveProperty("deltaTokens");
  });

  it("still omits token fields when the encoding load exceeds its budget", async () => {
    const { event } = await runFixture({
      raw: LARGE_RAW,
      // Never resolves: stands in for a stalled lazy import. The race must win,
      // which is the one thing this timer genuinely does.
      countTokensImpl: () => new Promise(() => {}),
    });

    expect(event).not.toHaveProperty("rawTokens");
  });
```

- [ ] **Step 2: Run the tests, confirm the first fails**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/record-output-tokens.test.ts`
Expected: the null test may already pass from Task 1 Step 5; the point of running now is to confirm which. Record the actual result before changing anything.

- [ ] **Step 3: Rename the constant and correct its comment**

Replace `packages/context-gate/src/record-output.ts:79-85` with:

```typescript
// Bounds the lazy js-tiktoken LOAD, which is the only async part of counting.
// Sized above the measured cold start (101/109/132 ms in three fresh processes,
// 2026-08-01). It does NOT bound `encode`: that is synchronous and holds the
// event loop, so this timer cannot interrupt it. The encode is bounded by
// MAX_REPETITIVE_CHARS / MAX_MEASURABLE_CHARS in output-filter instead.
// An earlier version of this constant was named TOKEN_COUNT_BUDGET_MS and its
// comment claimed to bound the work; measured 2026-08-05, 400 KB of repeated
// characters returned after 14,388 ms without it firing.
export const ENCODING_LOAD_BUDGET_MS = 500;
```

Update the reference at what is now roughly line 403 to use the new name.

The constant is also imported and asserted by the test file, so the rename
breaks it until both are updated. In
`packages/context-gate/test/record-output-tokens.test.ts`, change the import at
line 9 and the assertion at line 56:

```typescript
  it("keeps the load budget above the tokenizer's measured cold start", () => {
    // Cold-start first-call cost measured at 101-132 ms on 2026-08-01. This is
    // the async lazy import, which is exactly what this budget bounds — a value
    // at or below the cold start omits the fields on every spawned-hook run.
    expect(ENCODING_LOAD_BUDGET_MS).toBeGreaterThan(300);
  });
```

`TOKEN_COUNT_BUDGET_MS` is not exported from
`packages/context-gate/src/index.ts`, so the rename touches no package entry
and needs no changeset entry of its own beyond Task 5's.

- [ ] **Step 4: Correct the block comment above the counter call**

Replace the comment at `record-output.ts:388-390`:

```typescript
  // Measured over the SAME two texts deltaBytes is computed over, so bytes and
  // tokens describe one object. Fields are OMITTED — never zeroed — when the
  // counter declines (input above its size cap), when the encoding load times
  // out, or on error. A value in a field named rawTokens is measured or absent.
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/record-output-tokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/record-output-tokens.test.ts
git commit -m "fix(context-gate): name the budget for what it bounds"
```

---

### Task 3: Make the divergence exclusion visible

**Files:**
- Modify: `packages/bench-replay/src/token-divergence.ts`
- Test: `packages/bench-replay/test/token-divergence.test.ts`

**Interfaces:**
- Consumes: `count(text: string): Promise<number | null>` from Task 1.
- Produces: `TokenDivergenceReport` gains `excludedCorpora: string[]`.

A corpus the counter declined must not vanish silently. An offline divergence measurement that quietly drops rows reports a narrower sample than it claims.

- [ ] **Step 1: Write the failing test**

Append to the existing `packages/bench-replay/test/token-divergence.test.ts`:

```typescript
  it("names corpora the counter declined instead of dropping them silently", async () => {
    const report = await measureTokenDivergence(
      [
        { name: "ok", text: "hello world" },
        { name: "too-big", text: "X".repeat(50) },
      ],
      {
        estimate: (t) => Math.ceil(t.length / 4),
        count: async (t) => (t.startsWith("X") ? null : 3),
      },
    );

    expect(report.samples.map((s) => s.name)).toEqual(["ok"]);
    expect(report.excludedCorpora).toEqual(["too-big"]);
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/token-divergence.test.ts`
Expected: FAIL — `excludedCorpora` is undefined.

- [ ] **Step 3: Implement**

In `packages/bench-replay/src/token-divergence.ts`, add the field to the report type:

```typescript
export type TokenDivergenceReport = {
  encoding: string;
  samples: TokenDivergenceSample[];
  overallRealOverEstimate: number;
  // Corpora whose real count was declined (above output-filter's size caps).
  // Named, not dropped: a divergence figure must say what it did not cover.
  excludedCorpora: string[];
};
```

Replace the loop body and return:

```typescript
  const samples: TokenDivergenceSample[] = [];
  const excludedCorpora: string[] = [];
  for (const corpus of corpora) {
    const realTokens = await counters.count(corpus.text);
    if (realTokens === null) {
      excludedCorpora.push(corpus.name);
      continue;
    }
    const estimatedTokens = counters.estimate(corpus.text);
    samples.push({
      name: corpus.name,
      bytes: Buffer.byteLength(corpus.text, "utf8"),
      estimatedTokens,
      realTokens,
      realOverEstimate: estimatedTokens === 0 ? 1 : realTokens / estimatedTokens,
    });
  }
```

and add `excludedCorpora` to the returned object.

- [ ] **Step 4: Run it, confirm it passes**

Run: `pnpm --filter @megasaver/bench-replay exec vitest run test/token-divergence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-replay/src/token-divergence.ts packages/bench-replay/test/token-divergence.test.ts
git commit -m "fix(bench-replay): name declined corpora in divergence"
```

---

### Task 4: Mutation audit

**Files:** none changed. This task produces evidence only.

Each mutation below is applied, the named test run, the failure confirmed, and the mutation reverted. **A mutation that does not fail its test is a defect in the test, not in the mutation** — stop and report rather than adjusting the mutation to fit.

- [ ] **Step 1: Run all five mutations**

| # | mutation | run | must fail |
|---|---|---|---|
| 1 | `MAX_REPETITIVE_CHARS` → `400_000` | `output-filter test/tokens.test.ts` | "returns null for repetitive input above MAX_REPETITIVE_CHARS" |
| 2 | `return null` → `return 0` in both cap branches | `output-filter test/tokens.test.ts` | the two `toBeNull()` assertions |
| 3 | `CHUNK_SIZE` → `1000` | `output-filter test/tokens.test.ts` | "keeps the worst repetitive shape within a bounded multiple" |
| 4 | `longestRun` body → longest run of one repeated character | `output-filter test/tokens.test.ts` | "handles a period-8 shape quickly" (5 s timeout) |
| 5 | `if (rawTokens !== null && ...)` → always assign, coercing null to 0 | `context-gate test/record-output-tokens.test.ts` | "omits token fields when the counter returns null" |

For mutation 4, the replacement body is:

```typescript
function longestRun(text: string): number {
  let longest = 0;
  let current = 1;
  for (let i = 1; i < text.length; i++) {
    if (text.charCodeAt(i) === text.charCodeAt(i - 1)) {
      current++;
      if (current > longest) longest = current;
    } else current = 1;
  }
  return longest;
}
```

- [ ] **Step 2: Record the result of each in the report**

For each: the mutation, the test that went red, and the assertion message. Five reds expected.

---

### Task 5: Evidence, changeset, verify

**Files:**
- Create: `.changeset/saver-token-count-bound.md`
- Modify: `wiki/syntheses/verify-fresh-audit-2026-08-01.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Capture before/after wall clock on the saver suite**

```bash
git stash push -u -m "token-bound-measure" && \
  pnpm --filter @megasaver/cli exec vitest run test/hooks/saver-run.test.ts 2>&1 | tail -5
```

Then restore with `git stash list --format='%H %gs'`, `git stash apply <sha>`, and drop the entry by tag. Re-run the same command and record both durations. Do **not** use bare `git stash pop` — the stash stack is shared with other worktrees.

- [ ] **Step 2: Reproduce the spec's four measurement tables**

Run the shapes from spec §1, §2, §3.1 and §4.2 on this machine and record the numbers next to the spec's. Report any that differ by more than 2x — the caps are derived from them, and a machine that is much slower invalidates the headroom claim.

- [ ] **Step 3: Update the origin wiki page**

In `wiki/syntheses/verify-fresh-audit-2026-08-01.md`, mark the **Impact** section superseded: `pnpm verify` is no longer red on main, and the 539.71 s / 500 s figures predate the chunk guard. Keep §"The guard cannot work" — it was correct and is what this change acts on. Add a line pointing at this spec and plan.

- [ ] **Step 4: Append to `wiki/log.md`**

One timestamped entry naming the defect, the fix, and the measured before/after.

- [ ] **Step 5: Write the changeset**

```markdown
---
"@megasaver/output-filter": minor
"@megasaver/context-gate": patch
"@megasaver/bench-replay": patch
---

Token measurement on the saver hot path has a real bound. The 500 ms race in
`record-output` could never fire: `encode` is synchronous after memoization, so
the timer callback waited on the work it was meant to interrupt — measured
2026-08-05, 400 KB of repeated characters returned after 14,388 ms with the
budget silent. `countTokens` now returns `number | null` and declines input
above `MAX_REPETITIVE_CHARS` (32,768, chunked path) or `MAX_MEASURABLE_CHARS`
(2,097,152, whole-string path), each derived from a 1500 ms stall ceiling and a
measured worst-case rate with 3x headroom. `CHUNK_SIZE` drops 1000 to 250,
cutting the worst measured shape from 5,277 to 1,316 ms per 100 KB at identical
token counts on varied input. The caps are sizes, not times, so the same bytes
measure the same way on a fast machine and a slow one. `TOKEN_COUNT_BUDGET_MS`
is renamed `ENCODING_LOAD_BUDGET_MS` and keeps its 500 ms value, now bounding
only the lazy encoding load, which really is async. A declined row omits its
token fields; `mega audit honest` already reports the resulting coverage.
```

- [ ] **Step 6: Full verify**

Run: `pnpm verify`
Expected: exit 0. Record whether each affected package ran fresh or came from turbo cache — a cached green is not a green.

- [ ] **Step 7: Commit**

```bash
git add .changeset/saver-token-count-bound.md wiki/syntheses/verify-fresh-audit-2026-08-01.md wiki/log.md
git commit -m "docs(wiki): record the token-count bound and its evidence"
```

---

## Review gates (risk-modes §12, HIGH)

Both run in fresh contexts, neither authored by the implementer:

1. `architect` — the cap derivation and the determinism argument in spec §4.1, plus the two open questions in spec §8 (fixed cap versus first-use calibration; whether a whitespace-*containing* shape defeats `longestRun` while still being slow — only whitespace-free shapes were tested).
2. `critic` — adversarial pass over the mutation audit and the timing-assertion design.
