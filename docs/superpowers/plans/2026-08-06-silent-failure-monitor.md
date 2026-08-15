# Silent-Failure Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega alerts --failures` — a free, session-scoped report that runs four pure detectors (`tool-error`, `context-overflow`, `partial-completion`, `hallucinated-state`) over stores that already exist (overlay receipts, chunk-sets, read-index, compaction capsule), plus an opt-in, off-by-default, warn-only Stop hook (`mega hooks failure-scan`) that fires when the session stops with an unresolved failing receipt. A detector whose backing signal is absent reports `no-signal` with the reason — it never guesses (spec Goal 3).

**Architecture:** Everything new lives in `apps/cli/src/commands/failures/` plus one hook pair, per spec M1–M6 (`docs/superpowers/specs/2026-08-06-silent-failure-monitor-design.md`). `scanRefs` (M1) extracts chunk-id and path references from explicit input text. `loadFailureSnapshot` (M2) targets `(encodeWorkspaceKey(cwd), liveSessionId)` — flag or newest-by-`createdAt`, never mtime — degrades every store read to `undefined`/`[]`, and v1 hardcodes `chunkSets: []` / `capsule: undefined` (compaction-guard surfaces unshipped, spec Decision 8 amendment). `detectSilentFailures` (M3) is pure over the snapshot. `runAlertsFailures` (M4) is a cli-test-pattern run function; `alerts.ts` gains a mode-flag branch that runs BEFORE the Pro entitlement gate (spec Decision 1; the shipped citty resolves subcommands from the first non-dash rawArg, so a subcommand would break `mega alerts --days 30`). The Stop hook (M5) reuses claim-verification-gate's Stop plumbing with a disjoint trigger: the gate reminds iff ZERO in-window command receipts exist; the monitor warns iff ≥1 unresolved FAILING receipt exists — mutually exclusive by construction (spec Decision 7). M6 re-exports `loadReadIndex`/`hashPath` through core.

**Tech Stack:** TypeScript strict ESM, Vitest, Citty commands, `@megasaver/core` (`readOverlayEvents` re-export, `packages/core/src/context-gate.ts:91`), `@megasaver/content-store` (`listOverlayChunkSets`/`CAPSULE_FILENAME` — compaction-guard dep), `@megasaver/context-gate` (`loadReadIndex` `packages/context-gate/src/read-index.ts:21`, `hashPath` `:13`), `@megasaver/policy` (`redact`, `packages/policy/src/redact.ts:44` → `{ redacted, count }`), `@megasaver/shared` (`encodeWorkspaceKey`, `packages/shared/src/workspace-key.ts:20`), `@megasaver/connector-claude-code` (`buildHookCommand` `packages/connectors/claude-code/src/hook-settings.ts:34`, Stop helpers — gate dep).

## Global Constraints

- **Build-order preconditions (7 of 20, wave-2 batch).** This plan CONSUMES and never redefines: `childExitCode` on both event schemas + the exec writers (claim-verification-gate plan Task 1, `docs/superpowers/plans/2026-08-06-claim-verification-gate.md:28`) and its Stop plumbing — `hasStopHook`/`addStopHook`/`removeStopHook`/`writeSettingsFile` exports (gate Task 7, `:1222`). AMENDED 2026-08-15 (spec Decision 8 + Dependencies): the compaction-guard surfaces (`listOverlayChunkSets`, `CAPSULE_FILENAME`, `workStateCapsuleSchema`) are UNSHIPPED — v1 builds WITHOUT them: Task 3 hardcodes `chunkSets: []` and `capsule: undefined` by construction; the chunk-set source capture leg and the capsule annotation leg are deferred until compaction-guard lands (re-enabled additively, never re-implemented). The read-index leg carries the hallucinated-state detector in full. At RUNTIME the remaining degradations are data, not crashes: zero `childExitCode` rows → the dependent detector degrades to `no-signal` (spec Dependencies).
- **Fail-open hooks (§13):** `runFailureScanHookFromProcess` always exits 0 and prints nothing on any failure (outer try/catch, mirror of `runSaverHookFromProcess`, `apps/cli/src/hooks/saver-run.ts:156`). The Stop hook NEVER emits `decision: "block"` (spec Non-Goal 4).
- **Redact-on-echo (spec Decision 10):** every label, path, or excerpt printed by report or hook passes `redact()` (`packages/policy/src/redact.ts:44`) at render time. Nothing from the scanned input is persisted; chunk CONTENT is never read — only ids, sources, event metadata.
- **ReDoS discipline (spec Decision 9, wiki `concepts/redos-guard-testing`):** chunk refs use the single linear pattern `/\bcs-[0-9a-f]{8,64}\b/g` (matches the saver's `cs-<sha256-prefix>` ids, `apps/cli/src/hooks/saver.ts:425`); paths use a whitespace/quote tokenizer plus per-token anchored bounded validators — NO scanning regex over the whole input. Guard suite sized at the shipped cap `MAX_FAILURES_INPUT_BYTES = 8_388_608` with non-vacuity minimum match count, n-vs-4n min-per-size growth ratio, and a revert proven red (Task 2).
- **No timing-tight tests:** injected `now`; session pick is data-derived from event `createdAt`, never mtime (spec Decision 3); the growth-ratio guard uses min-per-size sampling with calibrated repeats and no runtime lower bound.
- **JSON policy:** `--json` output is ALWAYS JSON including the empty case; usage errors (bad `--window`, `--days`+`--failures`, oversized/unreadable `--file`) → message to stderr, EMPTY stdout, exit 1 (helpers in `apps/cli/src/errors.ts` — `mapErrorToCliMessage` `:126`, `fileReadFailedMessage` `:316`).
- **Pro path untouched:** the failures branch never calls `checkEntitlement`; the Pro anomaly `--json` AlertsReport contract (`apps/cli/src/commands/alerts.ts:109-113`) is not modified. `--days` combined with `--failures` is a usage error.
- **cli-test-pattern:** every run function takes an input struct with injected `stdout`/`stderr`/readers and returns `0 | 1`; the citty wrapper stays thin (model: `runAlerts`, `apps/cli/src/commands/alerts.ts:47`, tested via `apps/cli/test/commands/alerts.test.ts`).
- **No new packages, no new deps** (no pnpm catalog in this repo). Changesets for `@megasaver/cli`, `@megasaver/core`, `@megasaver/connector-claude-code` (DoD #9). Conventional commits ≤ 50-char subjects (§10); English output (§11). Risk MEDIUM (§12): worktree default, `code-reviewer` pass required; escalate to HIGH if any detector writes store data or the hook gains blocking power.

---

### Task 1: core re-exports `loadReadIndex` + `hashPath` (M6)

**Files:**
- Modify: `packages/core/src/context-gate.ts` (the `@megasaver/context-gate` re-export block closing at `:29`; precedent for the stats side: `readOverlayEvents` at `:91`)
- Test: `packages/core/test/read-index-reexport.test.ts` (new; mimics `packages/core/test/audit-reexport.test.ts`)

**Interfaces:**
- `packages/core/src/index.ts` already re-exports `./context-gate.js` wholesale; adding names to the block is sufficient. Source symbols verified: `hashPath` (`packages/context-gate/src/read-index.ts:13`), `loadReadIndex` (`:21`, returns `Record<string, ReadIndexEntry>`, degrades to `{}` on any read/parse failure), `type ReadIndexEntry` (`:6`); all three are on the context-gate public entry (`packages/context-gate/src/index.ts:65-72`).

- [ ] **Step 1: Write the failing test** `packages/core/test/read-index-reexport.test.ts`:

```typescript
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ReadIndexEntry, hashPath, loadReadIndex } from "../src/index.js";

describe("core re-exports the read-index surface (M6)", () => {
  it("exposes hashPath and loadReadIndex as functions", () => {
    expect(typeof hashPath).toBe("function");
    expect(typeof loadReadIndex).toBe("function");
    expect(hashPath("/work/a.ts")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loadReadIndex reads a session dir and degrades to {} when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-core-readindex-"));
    try {
      expect(loadReadIndex(join(dir, "missing"))).toEqual({});
      const entry: ReadIndexEntry = { contentHash: "c".repeat(64), chunkSetId: "cs-1" };
      // READ_INDEX_FILENAME = "read-index.json" (packages/content-store/src/store.ts:20)
      writeFileSync(join(dir, "read-index.json"), JSON.stringify({ [hashPath("/work/a.ts")]: entry }));
      expect(loadReadIndex(dir)[hashPath("/work/a.ts")]).toEqual(entry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/core test -- read-index-reexport`. Expected: `SyntaxError: The requested module '../src/index.js' does not provide an export named 'hashPath'`.
- [ ] **Step 3: Implement** — in `packages/core/src/context-gate.ts`, add `hashPath,`, `loadReadIndex,`, and `type ReadIndexEntry,` to the `@megasaver/context-gate` export block that closes at `:29` (alphabetical position within the block; one-line-per-name style of the block).
- [ ] **Step 4: GREEN** — `pnpm --filter @megasaver/core test -- read-index-reexport`, then `pnpm --filter @megasaver/core typecheck` if defined, else `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(core): re-export read-index surface`

---

### Task 2: `scanRefs` + input cap + ReDoS growth-ratio guard (M1)

**Files:**
- Create: `apps/cli/src/commands/failures/scan-refs.ts`
- Test: `apps/cli/test/failures/scan-refs.test.ts` (new)
- Test: `apps/cli/test/failures/scan-refs-redos.test.ts` (new; instrument per claim-verification-gate plan Task 3, `docs/superpowers/plans/2026-08-06-claim-verification-gate.md:378` — same wiki-derived shape)

**Interfaces:**
```typescript
// apps/cli/src/commands/failures/scan-refs.ts
export const MAX_FAILURES_INPUT_BYTES = 8_388_608; // the C3 cap (spec Decision 4)
export type ScannedRefs = { chunkRefs: readonly string[]; pathRefs: readonly string[] };
export function scanRefs(text: string): ScannedRefs; // pure; dedupes, first-seen order
```

Semantics: chunk refs = matches of `/\bcs-[0-9a-f]{8,64}\b/g`. Path refs = tokens from a whitespace/quote split, trailing `.`/`:` stripped, accepted iff they pass ONE anchored bounded validator: a slash-path class (`src/a/b.ts`, `./docs/x.md`) or a dotted-filename class (`package.json`). ASSUMPTION: the dotted-filename class requires a 2–8 char extension so prose abbreviations (`e.g.`, `i.e.`) never become phantom-path candidates; 1-char extensions are still caught by the slash-path class (`src/a.c`). ASSUMPTION: output bounded at `MAX_SCANNED_REFS = 4_096` per kind (first-seen), so a pathological input cannot balloon the report. The cap constant lives here; enforcement happens at the CLI boundary in Task 5 (§8: validate at boundaries, trust internals).

- [ ] **Step 1: Write the failing unit test** `apps/cli/test/failures/scan-refs.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { MAX_FAILURES_INPUT_BYTES, scanRefs } from "../../src/commands/failures/scan-refs.js";

describe("scanRefs — chunk refs", () => {
  it("finds cs- ids, dedupes, preserves first-seen order", () => {
    const a = `cs-${"a1f0".repeat(8)}`; // 32 hex — the saver's content-derived shape
    const b = `cs-${"0".repeat(12)}`;
    const refs = scanRefs(`see ${a} then ${b} and ${a} again`);
    expect(refs.chunkRefs).toEqual([a, b]);
  });

  it("rejects non-hex, too-short, uppercase, and embedded ids", () => {
    expect(scanRefs("cs-zzzzzzzz cs-1234567 xcs-aaaaaaaa cs-ABCDEF12").chunkRefs).toEqual([]);
  });
});

describe("scanRefs — path refs", () => {
  it("accepts slash paths and dotted filenames, strips quotes and trailing punctuation", () => {
    const refs = scanRefs('updated "src/commands/alerts.ts", package.json and ./docs/x.md.');
    expect(refs.pathRefs).toEqual(["src/commands/alerts.ts", "package.json", "./docs/x.md"]);
  });

  it("ignores prose, abbreviations, URLs, and over-long tokens", () => {
    const long = `a/${"b".repeat(600)}`;
    const refs = scanRefs(`plain words, e.g. i.e. https://example.com/a/b and ${long}`);
    expect(refs.pathRefs).toEqual([]);
  });

  it("exposes the shipped input cap", () => {
    expect(MAX_FAILURES_INPUT_BYTES).toBe(8_388_608);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/cli test -- failures/scan-refs`. Expected: `Failed to load .../src/commands/failures/scan-refs.js` (module does not exist).
- [ ] **Step 3: Implement** `apps/cli/src/commands/failures/scan-refs.ts`:

```typescript
export const MAX_FAILURES_INPUT_BYTES = 8_388_608;

// Decision 9: one linear scanning regex for chunk ids (fixed head, bounded hex
// run, \b fences); paths are tokenized and validated PER TOKEN with anchored
// bounded patterns — no scanning regex over the whole input.
const CHUNK_REF = /\bcs-[0-9a-f]{8,64}\b/g;
const TOKEN_SPLIT = /[\s"'`()<>,;]+/;
const TRAILING_PUNCT = /[.:]+$/;
const SLASH_PATH = /^\.{0,2}\/?[\w.@-]+(?:\/[\w.@-]+)+$/;
const DOTTED_FILE = /^[\w@-]+\.[A-Za-z0-9]{2,8}$/;
const MAX_TOKEN_LENGTH = 512;
const MAX_SCANNED_REFS = 4_096;

export type ScannedRefs = { chunkRefs: readonly string[]; pathRefs: readonly string[] };

export function scanRefs(text: string): ScannedRefs {
  const chunkRefs: string[] = [];
  const seenChunk = new Set<string>();
  for (const match of text.matchAll(CHUNK_REF)) {
    if (chunkRefs.length >= MAX_SCANNED_REFS) break;
    const id = match[0];
    if (!seenChunk.has(id)) {
      seenChunk.add(id);
      chunkRefs.push(id);
    }
  }
  const pathRefs: string[] = [];
  const seenPath = new Set<string>();
  for (const rawToken of text.split(TOKEN_SPLIT)) {
    if (pathRefs.length >= MAX_SCANNED_REFS) break;
    if (rawToken.length === 0 || rawToken.length > MAX_TOKEN_LENGTH) continue;
    const token = rawToken.replace(TRAILING_PUNCT, "");
    if (!SLASH_PATH.test(token) && !DOTTED_FILE.test(token)) continue;
    if (!seenPath.has(token)) {
      seenPath.add(token);
      pathRefs.push(token);
    }
  }
  return { chunkRefs, pathRefs };
}
```

- [ ] **Step 4: GREEN** — `pnpm --filter @megasaver/cli test -- failures/scan-refs`.
- [ ] **Step 5: Write the growth-ratio guard** `apps/cli/test/failures/scan-refs-redos.test.ts` (green by design; red proven by revert in Step 7):

```typescript
import { describe, expect, it } from "vitest";
import { MAX_FAILURES_INPUT_BYTES, scanRefs } from "../../src/commands/failures/scan-refs.js";

// Instrument per wiki concepts/redos-growth-ratio-measurement:
// - Ratio, not ceiling: input is arbitrary text up to the shipped cap; there is
//   no fixed defect cost to separate from. 4n IS the cap — no caller can
//   present a larger scan (Task 5 boundary enforcement).
// - Minimise per SIZE across trials, then divide — never min-of-ratios.
// - Repeat count calibrated from one real call; duration floor ~5 ms so the
//   ratio never measures the scheduler. Never assert a runtime lower bound.
const SMALL = MAX_FAILURES_INPUT_BYTES / 4; // 2 MiB
const LARGE = MAX_FAILURES_INPUT_BYTES; // 8 MiB — the shipped cap
const RATIO_THRESHOLD = 8;
const TRIALS = 3;
const TARGET_SAMPLE_MS = 50;

function repeatTo(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
}

// Near-miss shapes: starts that ENTER a pattern and fail. The word-char run
// probes the \b-guarded cs- head and the token validators; the cs- soup probes
// the bounded hex run (exactly where an unbounded {8,} edit would bite); the
// slashy soup probes the slash-path alternation tail.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a word-char run", "x"],
  ["cs- near-miss soup", "cs-abc cs-ab cs-a "],
  ["slashy token soup", "src/a src/ b//c ./x. "],
];

function minMsPerSize(input: string, repeats: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = performance.now();
    for (let r = 0; r < repeats; r += 1) scanRefs(input);
    const ms = (performance.now() - started) / repeats;
    if (ms < best) best = ms;
  }
  return best;
}

describe("scanRefs stays linear up to the shipped input cap", () => {
  for (const [label, unit] of SHAPES) {
    it(`grows ~linearly from 2 MiB to 8 MiB of ${label}`, { retry: 3, timeout: 120_000 }, () => {
      const small = repeatTo(unit, SMALL);
      const large = repeatTo(unit, LARGE);
      const probeMs = Math.max(minMsPerSize(small, 1), 0.5);
      const repeats = Math.max(1, Math.round(TARGET_SAMPLE_MS / probeMs));
      const smallMs = minMsPerSize(small, repeats);
      const largeMs = minMsPerSize(large, repeats);
      expect(largeMs / smallMs).toBeLessThan(RATIO_THRESHOLD);
    });
  }
});

describe("guard corpus is not vacuous", () => {
  // redos-guard-testing rule: assert a minimum match count before asserting
  // anything about what a corpus produced.
  const SEEDED =
    `stored in cs-${"ab12".repeat(8)} and cs-${"7".repeat(16)}; ` +
    'touched src/commands/alerts.ts, ./docs/plan.md and package.json';

  it("both ref kinds fire on the seeded corpus", () => {
    const refs = scanRefs(SEEDED);
    expect(refs.chunkRefs.length).toBeGreaterThanOrEqual(2);
    expect(refs.pathRefs.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 6: Run and pass** — `pnpm --filter @megasaver/cli test -- scan-refs-redos` (note the measured smallMs/largeMs in the PR notes).
- [ ] **Step 7: Prove the guard non-vacuous by revert** — temporarily replace the tokenizer+anchored-validator path leg with a single whole-input scanning regex `/(?:\.{0,2}\/)?[\w.@-]+(?:\/[\w.@-]+)+/g` (the realistic "just use one regex" regression): on the word-char run, every start position consumes the run and backtracks hunting a `/` — quadratic. Rerun: the word-char-run shape MUST go red on the ratio assertion. Quote the measured red ratio in the commit body, then restore. A margin claim is only load-bearing if the revert was actually performed (wiki `concepts/redos-growth-ratio-measurement`).
- [ ] **Step 8: Commit** — `feat(cli): failures reference scanner` (impl + unit test), then `test(cli): fence failure ref scan growth` (guard).

---

### Task 3: failure snapshot loader + newest-session pick (M2)

**Files:**
- Create: `apps/cli/src/commands/failures/snapshot.ts`
- Test: `apps/cli/test/failures/snapshot.test.ts` (new; seeds overlay JSONL like `apps/cli/test/hooks/guard-run.test.ts` seeds stores — tmpdir + literal writes)

**Interfaces:**
```typescript
// apps/cli/src/commands/failures/snapshot.ts
import type { OverlayTokenSaverEvent, ReadIndexEntry } from "@megasaver/core";
import type { ScannedRefs } from "./scan-refs.js";

export type FailureSnapshot = {
  workspaceKey: string;
  liveSessionId: string | undefined;
  events: readonly OverlayTokenSaverEvent[];
  chunkSets: readonly []; // v1 hardcode — compaction-guard unshipped (spec Decision 8 amendment)
  readIndex: Record<string, ReadIndexEntry> | undefined; // undefined = file absent (no-signal leg)
  capsule: undefined; // v1 hardcode — compaction-guard unshipped
  refs: ScannedRefs | undefined; // undefined = no input text
};

export function pickNewestSessionId(storeRoot: string, workspaceKey: string): string | undefined;
export async function loadFailureSnapshot(input: {
  storeRoot: string;
  cwd: string;
  liveSessionId?: string;
  inputText?: string;
}): Promise<FailureSnapshot>;
```

Semantics (spec Decision 3 + Error handling): `workspaceKey = encodeWorkspaceKey(cwd)` — same derivation as the intent hook. Session = the flag when given, else the session whose LAST parseable event has the newest `createdAt` across `<storeRoot>/stats/<wk>/*.events.jsonl` (`readdirSync`, filter `.events.jsonl`, `readOverlayEvents({ root }, wk, sid)` per candidate — data-derived, never mtime; malformed lines already skipped by `readOverlayEvents`, `packages/stats/src/store.ts:694`). Sessions with zero parseable events are skipped. ASSUMPTION: `createdAt` ties break by lexicographically larger session id, for determinism. Every store read degrades: missing stats dir → no session → `events: []`; read-index file absent (`join(storeRoot, "content", wk, sid, READ_INDEX_FILENAME)` not on disk) → `undefined`, else `loadReadIndex(sessionDir)`. `chunkSets` and `capsule` are v1 hardcodes (`[]` / `undefined`) — the chunk-set source leg and capsule annotation leg arrive with compaction-guard (never re-implemented here). `refs = inputText === undefined ? undefined : scanRefs(inputText)`.

- [ ] **Step 1: Write the failing test** `apps/cli/test/failures/snapshot.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFailureSnapshot, pickNewestSessionId } from "../../src/commands/failures/snapshot.js";

let store: string;
let cwd: string;
let wk: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failures-snap-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failures-snap-cwd-"));
  wk = encodeWorkspaceKey(cwd);
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function overlayRow(over: Record<string, unknown>): string {
  return `${JSON.stringify({
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: wk,
    createdAt: "2026-08-06T10:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    ...over,
  })}\n`;
}

function seedSession(sid: string, lastCreatedAt: string): void {
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sid}.events.jsonl`),
    overlayRow({ liveSessionId: sid, createdAt: lastCreatedAt }),
  );
}

describe("pickNewestSessionId", () => {
  it("picks by last-event createdAt, never mtime", () => {
    seedSession("sess-old", "2026-08-06T11:00:00.000Z");
    seedSession("sess-new", "2026-08-06T11:30:00.000Z");
    expect(pickNewestSessionId(store, wk)).toBe("sess-new");
  });

  it("returns undefined when the workspace has no event files", () => {
    expect(pickNewestSessionId(store, wk)).toBeUndefined();
  });
});

describe("loadFailureSnapshot degradation", () => {
  it("degrades every absent store to []/undefined, never throws", async () => {
    const snap = await loadFailureSnapshot({ storeRoot: store, cwd });
    expect(snap.liveSessionId).toBeUndefined();
    expect(snap.events).toEqual([]);
    expect(snap.chunkSets).toEqual([]);
    expect(snap.readIndex).toBeUndefined();
    expect(snap.capsule).toBeUndefined();
    expect(snap.refs).toBeUndefined();
  });

  it("loads events for the explicit session and scans provided input", async () => {
    seedSession("sess-a", "2026-08-06T10:00:00.000Z");
    const contentDir = join(store, "content", wk, "sess-a");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, "read-index.json"), JSON.stringify({ deadbeef: { contentHash: "c".repeat(64), chunkSetId: "cs-1" } }));
    writeFileSync(join(contentDir, "work-state-capsule.json"), "{not json"); // corrupt → undefined, not a crash
    const snap = await loadFailureSnapshot({
      storeRoot: store,
      cwd,
      liveSessionId: "sess-a",
      inputText: "touched src/a.ts",
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.readIndex).toBeDefined();
    expect(snap.capsule).toBeUndefined();
    expect(snap.refs?.pathRefs).toEqual(["src/a.ts"]);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/cli test -- failures/snapshot`. Expected: `Failed to load .../src/commands/failures/snapshot.js`.
- [ ] **Step 3: Implement** `snapshot.ts` per the interface block: imports `readOverlayEvents`, `loadReadIndex` from `@megasaver/core` (Task 1); `READ_INDEX_FILENAME`, `CAPSULE_FILENAME`, `listOverlayChunkSets` from `@megasaver/content-store` (`READ_INDEX_FILENAME` verified `packages/content-store/src/store.ts:20`; the other two are compaction-guard Task 1); `workStateCapsuleSchema` from `../../hooks/capsule.js` (compaction-guard Task 3); `encodeWorkspaceKey` from `@megasaver/shared`; `scanRefs` from `./scan-refs.js`. Every filesystem touch wrapped: `readdirSync` in try/catch → `[]`; capsule via `readFileSync` try/catch + `JSON.parse` try/catch + `safeParse`.
- [ ] **Step 4: GREEN** — `pnpm --filter @megasaver/cli test -- failures/snapshot`.
- [ ] **Step 5: Commit** — `feat(cli): failure snapshot loader`

---

### Task 4: four detectors + `detectSilentFailures` (M3)

**Files:**
- Create: `apps/cli/src/commands/failures/detectors.ts`
- Test: `apps/cli/test/failures/detectors.test.ts` (new; pure fixtures, injected clock/fs — no timers, no real store)

**Interfaces:**
```typescript
// apps/cli/src/commands/failures/detectors.ts
export type DetectorId = "tool-error" | "context-overflow" | "partial-completion" | "hallucinated-state";
export type DetectorVerdict = "findings" | "clear" | "no-signal" | "disabled";
export type DetectorResult = {
  id: DetectorId;
  verdict: DetectorVerdict;
  findings: readonly string[]; // already-redacted messages
  info: readonly string[]; // outside-workspace / exists-uncaptured listings (never findings)
  reason: string | undefined; // no-signal reason
  fix: string | undefined;
};
export type DetectOptions = {
  windowMinutes: number;
  nowMs: number;
  cwd: string;
  enabled: Readonly<Record<DetectorId, boolean>>;
  fileExists?: (absolutePath: string) => boolean; // default existsSync; injected in tests
  redactText?: (raw: string) => string; // default: policy redact(raw).redacted
};
export function unresolvedFailingReceipts(
  events: readonly OverlayTokenSaverEvent[],
  opts: { windowMinutes: number; nowMs: number },
): readonly OverlayTokenSaverEvent[]; // shared with the Task 6 hook — single definition
export function detectSilentFailures(snapshot: FailureSnapshot, opts: DetectOptions): readonly DetectorResult[];
```

Verdict semantics (spec Decisions 5–8; ASSUMPTION markers where the spec is silent):

- Shared: in-window iff `Date.parse(createdAt)` ∈ `[nowMs − windowMinutes·60 000, nowMs]`. ASSUMPTION: both edges inclusive. Recorded receipt := event with `sourceKind === "command"` AND `childExitCode !== undefined` (absent = pre-gate row, EXCLUDED — Decision 5). Failing := `childExitCode !== 0` (`null` = bound-killed child, counts as failing).
- **tool-error:** zero in-window recorded receipts → `no-signal` ("no exec receipts recorded in window — run commands through mega output exec"); ≥1 failing → `findings` (one per failing receipt: redacted `label` + exit code or "killed"); else `clear`.
- **partial-completion:** same recorded base → same `no-signal`; findings = `unresolvedFailingReceipts` output, labeled "unacknowledged-failure candidate" (Decision 6 — honest naming for a store-side proxy). Unresolved := failing receipt with (i) no LATER in-window recorded receipt with `childExitCode === 0` and (ii) no LATER event with `kind === "expansion"` carrying its `chunkSetId` (`kind` field: `packages/stats/src/event.ts:28`). A failing receipt without `chunkSetId` can only be resolved by leg (i).
- **context-overflow:** `refs === undefined` → `no-signal` ("no input text — pass --file or pipe stdin"). ASSUMPTION (verdict composition): known ids = defined `events[].chunkSetId` (v1: `chunkSets` is the compaction-guard hardcode `[]`, spec Decision 8 amendment); every `chunkRefs` entry not in the set is a dangling-ref finding ("referenced chunk <id> is not in this session's store"); input present with zero dangling (including zero chunk refs) → `clear`; the capsule annotation of the `fix` line arrives with compaction-guard (v1: no capsule mention).
- **hallucinated-state (3-way, Decision 8; only `phantom` is a finding):** `refs === undefined` → `no-signal`. ASSUMPTION: `readIndex === undefined` → `no-signal` ("no capture stores for this session"). Otherwise per path ref: resolve against `cwd`; outside-workspace (via `path.relative` escaping) → `info`, NEVER probed; inside: `captured` iff `readIndex?.[hashPath(abs)]` exists (v1: read-index leg only — the chunk-set `source.kind === "file"` leg is deferred to compaction-guard, spec Decision 8 amendment); not captured and `fileExists(abs)` → `exists-uncaptured` `info` (the saver captures only Read/LS/Bash/Grep/Glob/WebFetch — `apps/cli/src/hooks/saver.ts:28` — so agent-written files legitimately miss the index); neither → `phantom` finding. Existence probes are metadata-only and confined to cwd-contained paths.
- Disabled detectors return `{ verdict: "disabled", findings: [], info: [] }` and are excluded from `--strict` (Task 5).

- [ ] **Step 1: Write the failing test** `apps/cli/test/failures/detectors.test.ts` (fixture builder mirrors the overlay row shape used in Task 3's test; representative cases below — cover the spec test table in full):

```typescript
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
    const byId = run(snap({ events: [ev({ childExitCode: null }), ev({ label: "pre-gate row" })] }));
    expect(byId["tool-error"]?.verdict).toBe("findings");
    expect(byId["tool-error"]?.findings).toHaveLength(1);
  });

  it("zero recorded receipts → no-signal, never a guess", () => {
    const byId = run(snap({ events: [ev({})] })); // no childExitCode anywhere
    expect(byId["tool-error"]?.verdict).toBe("no-signal");
    expect(byId["tool-error"]?.reason).toContain("no exec receipts");
  });

  it("out-of-window failures do not fire", () => {
    const byId = run(snap({ events: [ev({ childExitCode: 2, createdAt: "2026-08-06T07:00:00.000Z" })] }));
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
    expect(unresolved["partial-completion"]?.findings[0]).toContain("unacknowledged-failure candidate");
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
  const refs = { chunkRefs: [], pathRefs: ["src/ghost.ts", "src/written.ts", "/etc/passwd"] } as const;

  it("phantom vs exists-uncaptured vs outside-workspace", () => {
    const byId = run(
      snap({ refs, readIndex: {} }),
      { fileExists: (abs: string) => abs.endsWith("src/written.ts") },
    );
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
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/cli test -- failures/detectors`. Expected: `Failed to load .../src/commands/failures/detectors.js`.
- [ ] **Step 3: Implement** `detectors.ts`: four pure functions + `detectSilentFailures` dispatching over the CLOSED `DetectorId` union (exhaustive `satisfies`-checked map, no default case — closed-enum discipline); `unresolvedFailingReceipts` exported for Task 6. Default `redactText` = `(raw) => redact(raw).redacted` (`packages/policy/src/redact.ts:44`); default `fileExists` = `existsSync`. Every finding/info string passes `redactText` before being returned (redact-on-echo lives HERE so both report and hook inherit it).
- [ ] **Step 4: GREEN** — `pnpm --filter @megasaver/cli test -- failures/detectors`.
- [ ] **Step 5: Commit** — `feat(cli): silent-failure detectors`

---

### Task 5: `runAlertsFailures` + renderer + `mega alerts` wiring (M4)

**Files:**
- Create: `apps/cli/src/commands/failures/report.ts` (report type + renderer)
- Create: `apps/cli/src/commands/failures/index.ts` (`runAlertsFailures`, `parseWindowMinutes`)
- Modify: `apps/cli/src/commands/alerts.ts` (`alertsCommand` args at `:152-156`; run wrapper at `:157-171` gains the early `--failures` branch)
- Test: `apps/cli/test/failures/report.test.ts` (new; harness mimics `apps/cli/test/commands/alerts.test.ts` — run helper with overrides, captured stdout/stderr arrays)

**Interfaces:**
```typescript
// apps/cli/src/commands/failures/report.ts
export type SilentFailureReport = {
  status: "silent-failure-report"; // ASSUMPTION: field names; spec pins only the type name + always-JSON
  windowMinutes: number;
  workspaceKey: string;
  liveSessionId: string | null;
  detectors: readonly DetectorResult[];
};
export function renderFailureReport(report: SilentFailureReport, stdout: (line: string) => void): void;

// apps/cli/src/commands/failures/index.ts
export function parseWindowMinutes(raw: string): number | null; // int 1..1440 (Decision 11); shape of parseDays (alerts.ts:19)
export type RunAlertsFailuresInput = {
  storeRoot: string;
  cwd: string;
  now: () => number;
  days?: string; // presence = usage error (--days is Pro-report-only, Decision 1)
  liveSession?: string;
  window?: string;
  file?: string;
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  json: boolean;
  strict: boolean;
  toolErrors: boolean;
  overflow: boolean;
  partial: boolean;
  hallucinated: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
export async function runAlertsFailures(input: RunAlertsFailuresInput): Promise<0 | 1>;
```

Flow: usage checks first (each → stderr message, empty stdout, exit 1): `days !== undefined` → "cannot combine --days with --failures"; bad `--window` (default 240); `--live-session` not matching the anchored segment pattern `/^[A-Za-z0-9._-]{1,200}$/` — ASSUMPTION: local validator because `isSafeSegment` is not exported from `@megasaver/stats` (the id is interpolated into a store path, §8 boundary rule); unreadable `--file` (`fileReadFailedMessage`, `apps/cli/src/errors.ts:316`); input text (file or piped stdin — TTY stdin means NO input, not an error) over `MAX_FAILURES_INPUT_BYTES` → "failures input exceeds 8 MiB cap". Then `loadFailureSnapshot` → `detectSilentFailures` (enabled map from the four booleans) → `--json` prints `JSON.stringify(report)` ALWAYS (including the no-session, all-no-signal case) → else `renderFailureReport`: header line, `  [<detector-id>] <finding>` lines (alerts style, `alerts.ts:133`), `no signal: <id> — <reason>` lines, `fix: …` lines. Exit: `--strict` → 1 iff any ENABLED detector verdict is `findings` (`no-signal` is not a finding, Decision 11); else 0.

`alertsCommand` args gain (citty, `--no-X` parses to `false` for a boolean with `default: true` — verified against the installed citty per spec Decision 2): `failures` (boolean, default false), `"live-session"` (string), `window` (string), `file` (string), `strict` (boolean, default false), `"tool-errors"`/`overflow`/`partial`/`hallucinated` (boolean, default true), plus Task 6's `"enable-hook"`/`"disable-hook"`. The run wrapper branches to `runAlertsFailures` when `args.failures` BEFORE constructing the Pro path — `checkEntitlement` (`alerts.ts:48`) is never called on the failures branch; `readAllEvents`/`readFirewallLog` are not touched.

- [ ] **Step 1: Write the failing test** `apps/cli/test/failures/report.test.ts` (mimic the `run()` override harness of `alerts.test.ts:68-98`; seed overlay JSONL as in Task 3):

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAlertsFailures } from "../../src/commands/failures/index.js";

const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let store: string;
let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failures-report-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failures-report-cwd-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function seedFailingReceipt(over: Record<string, unknown> = {}): void {
  const wk = encodeWorkspaceKey(cwd);
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  const row = {
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: wk,
    createdAt: "2026-08-06T11:30:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    childExitCode: 2,
    ...over,
  };
  writeFileSync(join(dir, "sess-a.events.jsonl"), `${JSON.stringify(row)}\n`);
}

function base() {
  return {
    storeRoot: store,
    cwd,
    now: () => NOW_MS,
    stdinIsTty: true,
    readStdin: async () => "",
    json: false,
    strict: false,
    toolErrors: true,
    overflow: true,
    partial: true,
    hallucinated: true,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  };
}

describe("runAlertsFailures", () => {
  it("--json is ALWAYS JSON, including the empty no-session case", async () => {
    expect(await runAlertsFailures({ ...base(), json: true })).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("silent-failure-report");
    expect(report.liveSessionId).toBeNull();
    expect(report.detectors).toHaveLength(4);
    expect(report.detectors.every((d: { verdict: string }) => d.verdict === "no-signal")).toBe(true);
  });

  it("failing receipt → [tool-error] table line; --strict exits 1; default exits 0", async () => {
    seedFailingReceipt();
    expect(await runAlertsFailures(base())).toBe(0);
    expect(out.join("\n")).toContain("[tool-error]");
    out = [];
    expect(await runAlertsFailures({ ...base(), strict: true })).toBe(1);
  });

  it("each opt-out marks its detector disabled and mutes it under --strict", async () => {
    seedFailingReceipt();
    const code = await runAlertsFailures({
      ...base(),
      json: true,
      strict: true,
      toolErrors: false,
      partial: false,
    });
    expect(code).toBe(0); // remaining enabled detectors are no-signal, not findings
    const report = JSON.parse(out[0] as string);
    const byId = Object.fromEntries(report.detectors.map((d: { id: string }) => [d.id, d]));
    expect(byId["tool-error"].verdict).toBe("disabled");
    expect(byId["partial-completion"].verdict).toBe("disabled");

    // Spec test-table CLI row: ALL FOUR opt-outs exercised — overflow and
    // hallucinated included, not just the two above.
    out = [];
    expect(
      await runAlertsFailures({
        ...base(),
        json: true,
        strict: true,
        toolErrors: false,
        overflow: false,
        partial: false,
        hallucinated: false,
      }),
    ).toBe(0); // nothing enabled → nothing can be a finding
    const allOff = JSON.parse(out[0] as string);
    expect(allOff.detectors).toHaveLength(4);
    expect(allOff.detectors.every((d: { verdict: string }) => d.verdict === "disabled")).toBe(
      true,
    );
  });

  it("usage errors: --days conflict and bad --window → stderr, empty stdout, exit 1", async () => {
    expect(await runAlertsFailures({ ...base(), days: "30" })).toBe(1);
    expect(out).toHaveLength(0);
    expect(err.join("\n")).toContain("--days");
    err = [];
    for (const window of ["0", "1441", "abc", "1.5"]) {
      expect(await runAlertsFailures({ ...base(), window })).toBe(1);
    }
    expect(out).toHaveLength(0);
  });

  it("runs free — no entitlement, and a secret-bearing label is never echoed raw", async () => {
    seedFailingReceipt({ label: `export AWS_SECRET_ACCESS_KEY=${SECRET}` });
    expect(await runAlertsFailures(base())).toBe(0); // no license in this store
    expect(out.join("\n")).not.toContain(SECRET);
  });
});
```

- [ ] **Step 2: Run and observe the expected failure** — `pnpm --filter @megasaver/cli test -- failures/report`. Expected: `Failed to load .../src/commands/failures/index.js`.
- [ ] **Step 3: Implement** `report.ts` + `failures/index.ts` per the flow above; stdin read only when `!stdinIsTty && file === undefined` (`for await (const chunk of process.stdin)` in the citty wrapper, injected as `readStdin` — the gate's `verify claims` pattern).
- [ ] **Step 4: Wire `alerts.ts`** — add the args; in `run({ args })`, when `args.failures` build `RunAlertsFailuresInput` (`storeRoot` via `readStoreEnv`/`resolveStorePath` as at `alerts.ts:158-159`, `cwd: process.cwd()`, `stdinIsTty: process.stdin.isTTY === true`) and return before `runAlerts`. Update the meta description to mention the free failures mode.
- [ ] **Step 5: GREEN** — `pnpm --filter @megasaver/cli test -- failures/report`, then the untouched-Pro regression: `pnpm --filter @megasaver/cli test -- commands/alerts` (all existing cases must stay green — DoD for Decision 1's zero-breakage claim).
- [ ] **Step 6: Commit** — `feat(cli): mega alerts --failures report`

---

### Task 6: opt-in `failure-scan` Stop hook + enable/disable toggle (M5)

**Files:**
- Modify: `packages/connectors/claude-code/src/hook-settings.ts` (`buildHookCommand` subcommand union at `:34` gains `"failure-scan"` — hyphenated path proven by `"cache-advice"`)
- Test: `packages/connectors/claude-code/test/failure-scan-command.test.ts` (new)
- Create: `apps/cli/src/hooks/failure-scan-run.ts`
- Create: `apps/cli/src/commands/hooks/failure-scan.ts`; register `"failure-scan"` in `apps/cli/src/commands/hooks/index.ts` `subCommands` (wrapper mirrors `apps/cli/src/commands/hooks/guard.ts`)
- Create: `apps/cli/src/commands/failures/hook-toggle.ts` (`runFailuresHookToggle`, driven by the `--enable-hook`/`--disable-hook` flags on `mega alerts --failures` — Decision 7)
- Test: `apps/cli/test/hooks/failure-scan.test.ts` (new; harness mirrors `apps/cli/test/hooks/guard-run.test.ts` + Task 3's JSONL seeding)
- Test: `apps/cli/test/failures/hook-toggle.test.ts` (new)

**Interfaces:**
```typescript
// apps/cli/src/hooks/failure-scan-run.ts
export const FAILURE_SCAN_WINDOW_MINUTES = 30; // ASSUMPTION: mirrors the gate's VERIFY_REMINDER_WINDOW_MINUTES; spec pins no hook window
export function buildFailureScanWarning(input: {
  events: readonly OverlayTokenSaverEvent[];
  nowMs: number;
  windowMinutes: number;
}): string | undefined; // pure; undefined = stay silent
export async function runFailureScanHookFromProcess(deps: {
  storeRoot: string;
  stdin: () => Promise<string>;
  stdout: (line: string) => void;
  nowMs?: () => number;
}): Promise<0>; // ALWAYS 0 (fail-open, runSaverHookFromProcess discipline — saver-run.ts:156)

// apps/cli/src/commands/failures/hook-toggle.ts
export function runFailuresHookToggle(input: {
  action: "enable" | "disable";
  settingsPath: string; // resolveClaudeCodeSettingsPath (apps/cli/src/commands/hooks/index.ts export)
  command: string; // buildHookCommand("failure-scan", cfg)
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}): 0 | 1; // uses hasStopHook/addStopHook/removeStopHook + writeSettingsFile (gate Task 7 exports)
```

Trigger (Decision 7, disjoint by construction): `buildFailureScanWarning` returns a warning iff ≥1 unresolved FAILING recorded receipt exists in-window — computed by the SAME `unresolvedFailingReceipts` the partial-completion detector uses (Task 4 export; one definition, two consumers). The gate's reminder fires iff ZERO in-window recorded receipts exist — the two conditions cannot both hold. Envelope: single stdout line `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":<warning>}}`; NEVER a `decision` field. Warning copy: one fixed sentence + the count + ONE redacted label (spec Security). ASSUMPTION (inherited from the gate spec): Stop stdout accepts `hookSpecificOutput.additionalContext`; fallback is `systemMessage`. Toggle: adds/removes a SECOND Stop entry keyed by the `failure-scan` subcommand — two same-event entries coexist (guard-hook precedent); `removeStopHook` strips only the owned command (PR #141 discipline).

- [ ] **Step 1: Write the failing connector test** `packages/connectors/claude-code/test/failure-scan-command.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildHookCommand } from "../src/index.js";

describe("buildHookCommand failure-scan", () => {
  it("builds the bare and store-baked forms", () => {
    expect(buildHookCommand("failure-scan")).toBe("mega hooks failure-scan");
    expect(buildHookCommand("failure-scan", { storeRoot: "/tmp/store" })).toBe(
      "mega hooks failure-scan --store /tmp/store",
    );
  });
});
```

- [ ] **Step 2: RED then implement** — expected failure: TS2345 (`"failure-scan"` not assignable to the subcommand union). Add `"failure-scan"` to the union at `hook-settings.ts:34-36`. GREEN: `pnpm --filter @megasaver/connector-claude-code test`.
- [ ] **Step 3: Write the failing hook test** `apps/cli/test/hooks/failure-scan.test.ts` — payload shape `{ session_id, cwd }` (Stop payload; same fields the gate's hook consumes):

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailureScanHookFromProcess } from "../../src/hooks/failure-scan-run.js";

const NOW_MS = Date.parse("2026-08-06T12:00:00.000Z");
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let store: string;
let cwd: string;
let out: string[];

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failure-scan-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failure-scan-cwd-"));
  out = [];
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

// Task 5's seedFailingReceipt fixture shape, verbatim, split so multi-row
// cases can seed resolution rows; createdAt sits inside the 30-minute
// FAILURE_SCAN_WINDOW_MINUTES (Task 5's 11:30 row rides the 240-min window).
function receipt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: encodeWorkspaceKey(cwd),
    createdAt: "2026-08-06T11:55:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    childExitCode: 2,
    ...over,
  };
}

function seedRows(rows: ReadonlyArray<Record<string, unknown>>): void {
  const dir = join(store, "stats", encodeWorkspaceKey(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "sess-a.events.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
}

async function run(stdinText: string): Promise<number> {
  return runFailureScanHookFromProcess({
    storeRoot: store,
    stdin: async () => stdinText,
    stdout: (l) => out.push(l),
    nowMs: () => NOW_MS,
  });
}

const payload = (): string => JSON.stringify({ session_id: "sess-a", cwd });

describe("runFailureScanHookFromProcess", () => {
  it("(a) unresolved failing receipt → one Stop envelope, never a decision", async () => {
    seedRows([receipt()]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] as string);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("Stop");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("1");
    expect(parsed.decision).toBeUndefined();
  });

  it("(b) failing receipt resolved by a later exit-0 receipt → silent", async () => {
    seedRows([
      receipt(),
      receipt({ id: "evt-2", createdAt: "2026-08-06T11:56:00.000Z", childExitCode: 0 }),
    ]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(c) no recorded receipts at all → silent (the gate's territory — disjoint)", async () => {
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(d) rows without childExitCode only → silent (pre-gate rows excluded)", async () => {
    seedRows([receipt({ childExitCode: undefined })]); // JSON.stringify drops undefined
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(e) malformed stdin → silent, still exit 0", async () => {
    seedRows([receipt()]);
    expect(await run("not json")).toBe(0);
    expect(out).toHaveLength(0);
  });

  it("(f) a secret-bearing label appears only redacted in additionalContext", async () => {
    seedRows([receipt({ label: `export AWS_SECRET_ACCESS_KEY=${SECRET}` })]);
    expect(await run(payload())).toBe(0);
    expect(out).toHaveLength(1);
    expect(out.join("\n")).not.toContain(SECRET);
  });
});
```

- [ ] **Step 4: RED then implement** `apps/cli/src/hooks/failure-scan-run.ts` (call shape for `readOverlayEvents` verified at `apps/cli/src/commands/audit/honest.ts:92`):

```typescript
import { redact } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { type OverlayTokenSaverEvent, readOverlayEvents } from "@megasaver/stats";
import { unresolvedFailingReceipts } from "../commands/failures/detectors.js";

// ASSUMPTION: mirrors the gate's VERIFY_REMINDER_WINDOW_MINUTES; spec pins no hook window.
export const FAILURE_SCAN_WINDOW_MINUTES = 30;

export function buildFailureScanWarning(input: {
  events: readonly OverlayTokenSaverEvent[];
  nowMs: number;
  windowMinutes: number;
}): string | undefined {
  const failing = unresolvedFailingReceipts(input.events, {
    windowMinutes: input.windowMinutes,
    nowMs: input.nowMs,
  });
  const first = failing[0];
  if (first === undefined) return undefined;
  // Spec Security: one fixed sentence + the count + ONE redacted label.
  return `${failing.length} recent command(s) exited non-zero with no later passing run or expansion — e.g. ${redact(first.label).redacted}. Verify before claiming done (mega alerts --failures).`;
}

export async function runFailureScanHookFromProcess(deps: {
  storeRoot: string;
  stdin: () => Promise<string>;
  stdout: (line: string) => void;
  nowMs?: () => number;
}): Promise<0> {
  try {
    const payload: unknown = JSON.parse(await deps.stdin());
    if (typeof payload !== "object" || payload === null) return 0;
    const record = payload as Record<string, unknown>;
    const sessionId = record["session_id"];
    const cwd = record["cwd"];
    if (typeof sessionId !== "string" || typeof cwd !== "string") return 0;
    const events = readOverlayEvents(
      { root: deps.storeRoot },
      encodeWorkspaceKey(cwd),
      sessionId,
    );
    const warning = buildFailureScanWarning({
      events,
      nowMs: (deps.nowMs ?? Date.now)(),
      windowMinutes: FAILURE_SCAN_WINDOW_MINUTES,
    });
    if (warning !== undefined) {
      deps.stdout(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "Stop", additionalContext: warning },
        }),
      );
    }
  } catch {
    // Fail-open: a Stop hook must never block the agent (saver-run.ts:156 discipline).
  }
  return 0;
}
```

Command wrapper `commands/hooks/failure-scan.ts` mirrors `guard.ts` (store flag only, "Internal:" description); register in `hooks/index.ts`. GREEN: `pnpm --filter @megasaver/cli test -- hooks/failure-scan`.
- [ ] **Step 5: Write the failing toggle test** `apps/cli/test/failures/hook-toggle.test.ts` (the seeded foreign entry uses the Claude Code settings hook shape the gate's helpers read/write):

```typescript
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailuresHookToggle } from "../../src/commands/failures/hook-toggle.js";

const FAILURE_SCAN = "mega hooks failure-scan";
const FOREIGN = "mega hooks verify-reminder"; // the gate's own Stop entry

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-hook-toggle-"));
  settingsPath = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function toggle(action: "enable" | "disable"): 0 | 1 {
  return runFailuresHookToggle({
    action,
    settingsPath,
    command: FAILURE_SCAN,
    stdout: () => {},
    stderr: () => {},
  });
}

describe("runFailuresHookToggle", () => {
  it("enable creates the Stop entry and is idempotent", () => {
    expect(toggle("enable")).toBe(0);
    const once = readFileSync(settingsPath, "utf8");
    expect(once).toContain(FAILURE_SCAN);
    expect(toggle("enable")).toBe(0);
    expect(readFileSync(settingsPath, "utf8")).toBe(once); // no duplicate entry
  });

  it("a foreign Stop entry survives enable and disable; disable strips only ours", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: FOREIGN }] }] },
      }),
    );
    expect(toggle("enable")).toBe(0);
    const enabled = readFileSync(settingsPath, "utf8");
    expect(enabled).toContain(FOREIGN);
    expect(enabled).toContain(FAILURE_SCAN);
    expect(toggle("disable")).toBe(0);
    const disabled = readFileSync(settingsPath, "utf8");
    expect(disabled).toContain(FOREIGN); // PR #141 discipline: strip only the owned command
    expect(disabled).not.toContain(FAILURE_SCAN);
  });
});
```

RED (module missing) → implement `hook-toggle.ts` with `hasStopHook`/`addStopHook`/`removeStopHook`/`writeSettingsFile` from `@megasaver/connector-claude-code` (gate Task 7 exports — consume, never redefine, per Global Constraints). Wire the `--enable-hook`/`--disable-hook` booleans in `alerts.ts` (only meaningful with `--failures`; both at once is a usage error) to call `runFailuresHookToggle` with `resolveClaudeCodeSettingsPath()` and `buildHookCommand("failure-scan", cfg)` — toggle runs INSTEAD of a scan. GREEN.
- [ ] **Step 6: Commit** — `feat(cli): failure-scan stop hook + toggle`

---

### Task 7: changesets, full verify, smoke evidence, wiki

**Files:**
- Create: `.changeset/silent-failure-monitor.md`
- Modify: `wiki/log.md`, `wiki/agent-channel.md` (status note); add `wiki/entities/` note only if a page for the failures surface is warranted

- [ ] **Step 1: Changeset** (`@megasaver/cli`, `@megasaver/core`, `@megasaver/connector-claude-code` — all patch, pre-1.0):

```markdown
---
"@megasaver/cli": patch
"@megasaver/core": patch
"@megasaver/connector-claude-code": patch
---

`mega alerts --failures`: free, session-scoped silent-failure report —
four detectors (tool-error, context-overflow, partial-completion,
hallucinated-state) over existing overlay stores, alerts-style table +
`--json`, per-detector opt-out, `--strict` CI exit. Detectors with no
backing signal report `no-signal`, never a guess. Opt-in warn-only Stop
hook (`mega hooks failure-scan`, off by default) fires when a session
stops with an unresolved failing receipt. Core re-exports the read-index
surface; the connector hook-command union gains `failure-scan`.
```

- [ ] **Step 2: `pnpm verify`** at the branch tip — lint + typecheck + full suite (includes `conventions:check`; no conventions edited, so no drift expected).
- [ ] **Step 3: Smoke evidence** (DoD #5 — captured terminal session). The monitor reads OVERLAY sessions (spec Non-Goal 3), so seed the overlay row with the shipped writer path unavailable to a bare shell by writing the JSONL a hook would have written:

```bash
pnpm --filter @megasaver/cli build
STORE=$(mktemp -d)
node apps/cli/dist/cli.js alerts --failures --json --store "$STORE"      # empty case: ALWAYS JSON, exit 0
node apps/cli/dist/cli.js alerts --failures --days 30 --store "$STORE"; echo "exit=$?"   # usage error, exit 1
node -e '
  const { encodeWorkspaceKey } = require("@megasaver/shared");
  const { mkdirSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  const wk = encodeWorkspaceKey(process.cwd());
  const dir = join(process.env.STORE, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "smoke-sess.events.jsonl"), JSON.stringify({
    id: "evt-1", liveSessionId: "smoke-sess", workspaceKey: wk,
    createdAt: new Date().toISOString(), sourceKind: "command",
    label: "pnpm test", rawBytes: 100, returnedBytes: 40, bytesSaved: 60,
    savingRatio: 0.6, summary: "1 kept", childExitCode: 2 }) + "\n");
' # (run with STORE exported; if require of workspace pkgs is awkward, use apps/cli/dist internals — evidence only)
node apps/cli/dist/cli.js alerts --failures --store "$STORE"             # [tool-error] + partial-completion candidate
node apps/cli/dist/cli.js alerts --failures --strict --store "$STORE"; echo "exit=$?"    # exit 1
node apps/cli/dist/cli.js alerts --failures --no-tool-errors --no-partial --strict --store "$STORE"; echo "exit=$?"  # exit 0
echo '{"session_id":"smoke-sess","cwd":"'"$PWD"'"}' | node apps/cli/dist/cli.js hooks failure-scan --store "$STORE"  # Stop envelope
```

Expected: first `--json` run prints a `silent-failure-report` document with four `no-signal` detectors; the seeded run prints `[tool-error]` and an unacknowledged-failure candidate; `--strict` exits 1 then 0 with the opt-outs; the hook prints one `hookSpecificOutput` line with `hookEventName: "Stop"`. Also capture `alerts --failures --enable-hook`, the resulting `hooks.Stop` entry in a scratch settings file, and `--disable-hook` removing only it. Capture all output.

- [ ] **Step 4: Wiki** — append `wiki/log.md` entry (`## [date] feature | silent-failure-monitor`), drop a handoff note in `wiki/agent-channel.md`; cite the spec + this plan.
- [ ] **Step 5: Commit** — `chore: changeset for silent-failure monitor`
- [ ] **Step 6: Review gates** — `code-reviewer` pass (spec risk MEDIUM, §12), then `verifier` with the smoke capture (DoD #6/#7). Author and reviewer never the same active context. Reviewer may upgrade risk; never silently downgrade.

---

## Self-review notes

- **Every referenced symbol is verified or explicitly owned elsewhere.** Verified in-repo: `runAlerts`/`parseDays`/entitlement gate (`apps/cli/src/commands/alerts.ts:19/:47/:48`), alerts registration (`apps/cli/src/main.ts:65`), `readOverlayEvents` (`packages/stats/src/store.ts:694`; core re-export `packages/core/src/context-gate.ts:91`; call shape `apps/cli/src/commands/audit/honest.ts:92`), `hashPath`/`loadReadIndex`/`ReadIndexEntry` (`packages/context-gate/src/read-index.ts:13/:21/:6`, public entry `packages/context-gate/src/index.ts:65-72`), `encodeWorkspaceKey` (`packages/shared/src/workspace-key.ts:20`), `redact` → `{ redacted, count }` (`packages/policy/src/redact.ts:44`), `buildHookCommand` union (`packages/connectors/claude-code/src/hook-settings.ts:34`), `READ_INDEX_FILENAME` (`packages/content-store/src/store.ts:20`), `ChunkSetSummary` (`packages/content-store/src/chunk-set.ts:57`), chunk-set `source` union (`:22`), overlay event schema + `kind: "expansion"` (`packages/stats/src/event.ts:28/:72-100`), saver capture set + `cs-` id derivation (`apps/cli/src/hooks/saver.ts:28/:425`), error helpers (`apps/cli/src/errors.ts:126/:316`), hooks subcommand registration + `resolveClaudeCodeSettingsPath` (`apps/cli/src/commands/hooks/index.ts`), fail-open model (`apps/cli/src/hooks/saver-run.ts:156`). Owned by predecessors and consumed here (Global Constraints preconditions): `childExitCode` + Stop helpers + `writeSettingsFile` (claim-verification-gate plan Tasks 1/7), `listOverlayChunkSets`/`CAPSULE_FILENAME` (compaction-guard Task 1), `workStateCapsuleSchema` (compaction-guard Task 3).
- **Not-yet-verified-by-compiler risk is confined to Tasks 3 and 6**, which import the predecessor surfaces; both tasks state the owning plan and the rule "land the owning task first, never re-implement". Runtime absence of the DATA (no `childExitCode` rows, no capsule) is handled by `no-signal` — landing order cannot make the monitor lie (spec Dependencies).
- **Test harnesses mimic tests actually read:** `packages/core/test/audit-reexport.test.ts` (Task 1), `apps/cli/test/commands/alerts.test.ts` (Task 5 harness + usage-error loop), `apps/cli/test/hooks/guard-run.test.ts` (Task 6 hook cases), and the gate plan's growth-ratio instrument (Task 2), itself derived from `packages/policy/test/redact-superlinear.test.ts` per wiki `concepts/redos-guard-testing`.
- **No timing-tight tests:** the only timing assertions are the Task 2 growth ratios (min-per-size, calibrated repeats, `retry: 3`, no lower bound); everything else injects `now`/`nowMs` and derives session choice from `createdAt` data.
- **ASSUMPTION inventory (11):** session-pick tie-break (T3); dotted-file 2–8 char extension (T2); `MAX_SCANNED_REFS` bound (T2); inclusive window edges (T4); context-overflow verdict composition (T4); hallucinated-state no-signal when both capture stores are absent (T4); `DetectorResult.info` channel for the two non-finding classes (T4); `SilentFailureReport` field names (T5); local `--live-session` segment validator (T5); `FAILURE_SCAN_WINDOW_MINUTES = 30` (T6); Stop `additionalContext` envelope inherited from the gate spec (T6). Each is small, reviewer-visible, and none weakens a spec-locked decision.
- **Spec fidelity spot-checks:** failures branch precedes entitlement and `--days` conflicts (Decision 1); closed 4-id union with `--no-X` opt-outs (Decision 2); writer/reader parity via `encodeWorkspaceKey` + data-derived session pick (Decision 3); explicit-input-only with the 8 MiB C3 cap (Decision 4); `null` exit failing, absent excluded (Decision 5); expansion-row + success-receipt resolution (Decision 6); disjoint Stop triggers sharing one `unresolvedFailingReceipts` definition (Decision 7); 3-way hallucinated-state with cwd-confined metadata-only probes (Decision 8); linear-by-construction patterns + guard + revert (Decision 9); redact-on-echo centralized in the detectors so report and hook cannot diverge (Decision 10); window 1..1440 default 240 and `--strict` semantics (Decision 11).
