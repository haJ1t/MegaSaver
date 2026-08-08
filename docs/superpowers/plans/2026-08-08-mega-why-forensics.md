# `mega why` Forensics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega why <sessionId> --project <name>` — a single
command that composes the already-shipped decision trace, the
already-shipped chunk store, and the already-shipped stats event
stream into one raw-vs-delivered forensic view for the most recent
(or selected) tool output (spec:
`docs/superpowers/specs/2026-08-08-mega-why-forensics-design.md`).

**Architecture:** A pure chunk-index helper joins a `DecisionOutput`'s
omitted line ranges to the chunk ids `fetchChunk` already knows how
to resolve. `runWhy` mirrors `runTraceExplain`'s existing store-
resolve/session-parse/registry-lookup skeleton, then fetches omitted
chunks and correlates the matching `TokenSaverEvent` by `chunkSetId`.
No new persistence, no schema changes, one new CLI command file.

**Tech Stack:** TypeScript strict ESM, Zod, Citty, Vitest,
cli-test-pattern (injected readers, temp stores).

## Global Constraints

- No new persistence, no new schema, no new redaction path — every byte this command prints already exists on disk today, written by already-reviewed code (spec Non-Goals).
- Missing evidence ALWAYS renders as an explicit, distinctly-worded gap line (spec Locked Decision 4) — never a thrown error, never a silently-omitted section, never a fabricated placeholder.
- Event correlation is `chunkSetId`-equality ONLY (spec Locked Decision 5) — never nearest-timestamp, never toolName-only matching. An unmatched output reports `receipt: none found`, full stop.
- `childExitCode` is read as `event.childExitCode ?? "unrecorded"` — this plan does NOT add the field itself (owned by the batch-1 `claim-verification-gate` pair per `wiki/log.md`'s cross-pair lock) and must work correctly whether that field exists yet or not (spec Dependencies).
- Free tier: `mega why` never calls `checkEntitlement` (spec Locked Decision 6).
- `mega trace explain` and `mega output chunk`'s existing bodies are NOT modified — only read from / imported from where explicitly noted (spec Risk & process regression evidence).
- cli-test-pattern: injected readers, `mkdtempSync` temp stores, `as never` Citty handler invocation for router-level tests, no timing-tight assertions.

---

### Task 1: `chunkIndexesForLineRange` pure helper

**Files:**
- Modify: `packages/output-filter/src/decision-trace.ts` (add export)
- Modify: `packages/output-filter/src/index.ts` (re-export)
- Modify: `packages/output-filter/test/decision-trace.test.ts` (new tests; check filename matches the existing test file for this source file first)

**Interfaces:**

```ts
// decision-trace.ts addition
export function chunkIndexesForLineRange(
  startLine: number,
  endLine: number,
  chunkLines: number,
): number[];
```

**Steps:**

- [ ] Read `packages/context-gate/src/recovery-footer.ts` in full (it is short) to find the EXACT arithmetic it uses to map a line into a chunk index (`buildRecoveryFooter`'s body, around `recovery-footer.ts:42`) — the new helper must use the identical formula, not a plausible-looking reimplementation.
- [ ] Write the failing test, appended to the existing decision-trace test file (find it via `rg -l "readSessionDecisionTrace" packages/output-filter/test`):

```ts
describe("chunkIndexesForLineRange", () => {
  it("returns a single index for a range fully inside one chunk", () => {
    expect(chunkIndexesForLineRange(5, 10, 40)).toEqual([0]);
  });
  it("returns two indexes for a range spanning a chunk boundary", () => {
    expect(chunkIndexesForLineRange(35, 45, 40)).toEqual([0, 1]);
  });
  it("includes index 0 for a range starting at line 0", () => {
    expect(chunkIndexesForLineRange(0, 3, 40)).toEqual([0]);
  });
  it("handles the exact chunk boundary (line 39 vs line 40) correctly per the recovery-footer formula", () => {
    // Fill in the expected value AFTER reading recovery-footer.ts's real
    // boundary convention (inclusive/exclusive end) — do not guess here.
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/output-filter exec vitest run test/decision-trace.test.ts` — expect FAIL.
- [ ] Implement `chunkIndexesForLineRange` in `decision-trace.ts`, using the formula confirmed from `recovery-footer.ts`:

```ts
// Mirrors buildRecoveryFooter's chunk-index arithmetic exactly (recovery-footer.ts) —
// the two must agree, or a chunk index this function names would not match
// what the recovery footer already told the agent to expand.
export function chunkIndexesForLineRange(
  startLine: number,
  endLine: number,
  chunkLines: number,
): number[] {
  const first = Math.floor(startLine / chunkLines);
  const last = Math.floor(endLine / chunkLines);
  const out: number[] = [];
  for (let i = first; i <= last; i += 1) out.push(i);
  return out;
}
```

- [ ] Adjust the implementation if the boundary test from the previous step reveals `recovery-footer.ts` uses a different (e.g. ceiling, or exclusive-end) convention — the test is authority; make the implementation match it, not the other way around.
- [ ] Export from `packages/output-filter/src/index.ts` alongside the existing `readSessionDecisionTrace`/`DecisionOutput` exports.
- [ ] GREEN: re-run — expect PASS.
- [ ] Commit:

```bash
git add packages/output-filter/src/decision-trace.ts packages/output-filter/src/index.ts packages/output-filter/test/decision-trace.test.ts
git commit -m "feat(output-filter): add chunkIndexesForLineRange, mirrors recovery-footer arithmetic"
```

---

### Task 2: Export `renderOutput` from `trace/explain.ts`

**Files:**
- Modify: `apps/cli/src/commands/trace/explain.ts` (export the existing private function)
- Modify: `apps/cli/src/commands/trace/index.ts` (re-export)

**Steps:**

- [ ] Change `function renderOutput(o: DecisionOutput): string[] {` to `export function renderOutput(o: DecisionOutput): string[] {` in `explain.ts` — no other change to the function body (spec Risk & process: `trace explain`'s existing output must stay byte-identical).
- [ ] Add `renderOutput` to `trace/index.ts`'s existing re-export list (alongside `renderDecisionTrace`).
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/commands/trace` (or the specific existing trace-explain test file) to confirm this export-only change causes ZERO test diffs — this step has no new test of its own; it is a visibility change consumed by Task 3.
- [ ] Commit:

```bash
git add apps/cli/src/commands/trace/explain.ts apps/cli/src/commands/trace/index.ts
git commit -m "refactor(cli): export renderOutput so mega why can reuse the trace summary line"
```

---

### Task 3: Shared savings-event reader extraction (CLI-side)

**Files:**
- Create: `apps/cli/src/commands/shared/savings-events.ts`
- Modify: `apps/cli/src/commands/savings/shared.ts` (re-export from the new shared location, keep its own call sites unchanged)
- Modify: `apps/cli/test/commands/shared/savings-events.test.ts` (new; mirrors whatever test already covers `defaultSavingsEventReader` in the savings command tests — check first, port the fixture)

**Interfaces:**

```ts
// apps/cli/src/commands/shared/savings-events.ts
export type SavingsSnapshot = { events: TokenSaverEvent[]; eventsByProject: Record<string, TokenSaverEvent[]> };
export type SavingsEventReader = () => SavingsSnapshot | Promise<SavingsSnapshot>;
export function defaultSavingsEventReader(storeInput: ResolveStorePathInput): SavingsEventReader;
```

**Steps:**

- [ ] Read `apps/cli/src/commands/savings/shared.ts` in full — confirm whether `defaultSavingsEventReader` has any savings-specific coupling (e.g. imports only relevant to ROI/alerts) before moving it; if it is already a clean, standalone function (as the investigation suggested), this is a pure relocation.
- [ ] Write the failing test in `apps/cli/test/commands/shared/savings-events.test.ts`, adapted from whatever existing test exercises `defaultSavingsEventReader` today (find via `rg -l "defaultSavingsEventReader" apps/cli/test`):

```ts
import { defaultSavingsEventReader } from "../../../src/commands/shared/savings-events.js";
// port the existing fixture/assertions from the savings command's own test file
```

- [ ] RED: run the new test file — expect FAIL (module not found).
- [ ] Move `SavingsSnapshot`/`SavingsEventReader`/`defaultSavingsEventReader`'s implementation into the new `apps/cli/src/commands/shared/savings-events.ts` file verbatim (byte-identical body, only the file location changes).
- [ ] In `apps/cli/src/commands/savings/shared.ts`, replace the moved implementation with a re-export: `export { type SavingsSnapshot, type SavingsEventReader, defaultSavingsEventReader } from "../shared/savings-events.js";` — every existing importer of `savings/shared.ts`'s reader (roi.ts, alerts.ts, bench.ts, etc.) continues to work unchanged.
- [ ] GREEN: run the new test AND the full existing savings command test suite (`pnpm --filter @megasaver/cli exec vitest run test/commands/savings` or wherever those tests live) — expect zero regressions.
- [ ] Commit:

```bash
git add apps/cli/src/commands/shared/savings-events.ts apps/cli/src/commands/savings/shared.ts apps/cli/test/commands/shared/savings-events.test.ts
git commit -m "refactor(cli): relocate defaultSavingsEventReader to commands/shared for cross-command reuse"
```

---

### Task 4: `mega why` command — selection, chunk fetch, event correlation, render

**Files:**
- Create: `apps/cli/src/commands/why.ts`
- Modify: `apps/cli/src/main.ts` (register `why: whyCommand`)
- Create: `apps/cli/test/commands/why.test.ts`

**Interfaces:**

```ts
export type RunWhyInput = {
  sessionId: string;
  projectName: string;
  toolFlag: string | undefined;
  indexFlag: number | undefined;
  workspaceFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string; home: string; xdgDataHome: string | undefined;
  platform: NodeJS.Platform; localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runWhy(input: RunWhyInput): Promise<0 | 1>;
export function renderWhy(result: WhyResult): string[];
```

**Steps:**

- [ ] Read `apps/cli/src/commands/trace/explain.ts`'s `runTraceExplain` in full one more time immediately before writing this task — `runWhy` shares its store-resolve → project-lookup → session-id-parse → `readSessionDecisionTrace` call skeleton verbatim through that point; diverging unnecessarily from a proven pattern is a bug magnet.
- [ ] Write the failing tests in `apps/cli/test/commands/why.test.ts`, following `apps/cli/test/commands/trace` (or wherever `trace explain`'s own tests live) for store-seeding conventions:

```ts
describe("runWhy", () => {
  it("selects the newest output by default", async () => { /* seed a trace with 2 outputs, assert the SECOND (last) one's summary line appears */ });
  it("--index N selects trace.outputs[N] exactly", async () => { /* seed 3 outputs, --index 0, assert the FIRST one's summary appears */ });
  it("--index out of range is a usage error, exit 1", async () => { /* seed 1 output, --index 5 */ });
  it("--tool <name> selects the last matching output", async () => { /* seed outputs from two different tools, assert the right one wins */ });

  it("dropped-range chunk fetch: real fetched text appears for an omitted range with a stored chunk set", async () => { /* seed trace + matching chunk set via saveChunkSet fixture, assert the DROPPED section contains the seeded chunk text */ });
  it("chunk-set-not-found → the exact gap label, exit 0", async () => { /* seed a trace whose chunkSetId points at nothing */ });
  it("null chunkSetId on the output → the 'not recoverable' gap label", async () => {});

  it("receipt: matching event by chunkSetId populates sourceKind/label/bytes", async () => { /* seed a TokenSaverEvent with the same chunkSetId as the trace output */ });
  it("receipt: childExitCode present on the event renders its value; absent renders 'unrecorded'", async () => { /* two seeded event fixtures, one with childExitCode: 0, one without the field */ });
  it("receipt: no matching event → 'receipt: none found'", async () => {});

  it("--json emits kept/dropped/receipt fields, never mixed with text output", async () => {});
});
```

- [ ] Confirm the exact fixture-seeding helpers to use for a decision trace (`writeReplayTrace`? a raw JSONL append? check `apps/cli/test/commands/trace/*.test.ts` — or wherever those tests actually live, the investigation did not locate the exact test file path — for the established seeding pattern) and for a chunk set (`saveChunkSet` from `@megasaver/content-store`, same helper `apps/cli/test`'s output-command tests already use) BEFORE writing the fixtures above; port the exact pattern rather than inventing a new one.
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/commands/why.test.ts` — expect FAIL (module not found).
- [ ] Implement `apps/cli/src/commands/why.ts`:

```ts
import {
  type DecisionOutput,
  type SessionDecisionTrace,
  chunkIndexesForLineRange,
  readSessionDecisionTrace,
} from "@megasaver/output-filter";
import { fetchChunk } from "@megasaver/core"; // confirm re-export path; context-gate's fetchChunk is re-exported via core per the existing output/chunk.ts import
import { sessionIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { renderOutput } from "./trace/explain.js";
import { defaultSavingsEventReader } from "./shared/savings-events.js";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
import { projectNameSchema } from "./shared/schemas.js";

const OVERLAY_CHUNK_LINES = 40; // TODO(implementation): import from @megasaver/context-gate's real export once confirmed, do not hardcode a magic number that could drift from the source of truth

export type WhyDroppedEntry = {
  startLine: number;
  endLine: number;
  score: number;
  text: string | null;
  gap: "no-chunk-set" | "pruned" | null;
};

export type WhyResult = {
  summaryLines: string[];
  kept: DecisionOutput["selected"];
  dropped: WhyDroppedEntry[];
  receipt:
    | { found: false }
    | {
        found: true;
        sourceKind: string;
        label: string;
        rawBytes: number;
        returnedBytes: number;
        childExitCode: number | null | "unrecorded";
      };
};

function selectOutput(
  trace: SessionDecisionTrace,
  toolFlag: string | undefined,
  indexFlag: number | undefined,
): { output: DecisionOutput } | { error: string } {
  if (indexFlag !== undefined) {
    const o = trace.outputs[indexFlag];
    if (o === undefined) return { error: `--index ${indexFlag} out of range (0..${trace.outputs.length - 1})` };
    return { output: o };
  }
  if (toolFlag !== undefined) {
    const matches = trace.outputs.filter((o) => o.toolName === toolFlag);
    const last = matches[matches.length - 1];
    if (last === undefined) return { error: `no output found for --tool ${toolFlag}` };
    return { output: last };
  }
  const newest = trace.outputs[trace.outputs.length - 1];
  if (newest === undefined) return { error: "no decision traces for this session yet" };
  return { output: newest };
}

// ... runWhy(input) composes: store resolve, project lookup, session parse
// (verbatim skeleton from runTraceExplain through readSessionDecisionTrace),
// selectOutput, per-omitted-range fetchChunk with chunkIndexesForLineRange,
// event correlation by chunkSetId equality, renderWhy(...) or JSON emit.
```

- [ ] **STOP and resolve the `fetchChunk`/`OVERLAY_CHUNK_LINES` import paths for real before finalizing** — the snippet above marks both with explicit uncertainty. Check (a) whether `fetchChunk` is re-exported from `@megasaver/core` (the way `output/chunk.ts` imports it) or must come from `@megasaver/context-gate` directly, and use whichever `apps/cli`'s dependency-graph allow-list actually permits (`@megasaver/core` is definitely allowed; `@megasaver/context-gate` is ALSO allowed per the allow-list captured during investigation — prefer importing from wherever `output/chunk.ts` already imports it from, for consistency); (b) whether `OVERLAY_CHUNK_LINES` is on `@megasaver/context-gate`'s public `index.ts` (confirmed YES during investigation, `context-gate/src/index.ts:60`) — import it from there, delete the hardcoded `40` and its TODO comment entirely.
- [ ] Write the full `runWhy` body: store resolve → project lookup (`projectNotFoundMessage` on miss) → `sessionIdSchema` parse → optional `--workspace` parse (mirrors `trace/explain.ts`'s exact optional-flag handling) → `readSessionDecisionTrace` → `selectOutput` (usage error → stderr + exit 1 on the `{error}` branch) → for each `output.omitted` entry: compute `chunkIndexesForLineRange(startLine, endLine, OVERLAY_CHUNK_LINES)`, dedupe indexes across ranges, `fetchChunk` once per unique index (catch per-chunk per spec Error handling — a thrown/`store_corrupt` result becomes a `gap: "pruned"` entry for that range, never aborts the whole command), map fetched text back onto each `WhyDroppedEntry` → correlate the event via `defaultSavingsEventReader`'s output filtered to `chunkSetId === output.chunkSetId` → build `WhyResult` → `input.json` ? `JSON.stringify(result)` : `renderWhy(result).forEach(input.stdout)`.
- [ ] Implement `renderWhy(result: WhyResult): string[]`: reuse `renderOutput`-equivalent summary (pass the selected `DecisionOutput` through the imported `renderOutput`), then append a blank line + `"KEPT:"` + one line per `kept` entry (same format `renderOutput` already uses for its per-chunk lines — reuse that exact string template, do not invent a new one), + blank + `"DROPPED:"` + one block per `dropped` entry (range/score line, then either the fetched text indented, or the gap label), + blank + `"RECEIPT:"` + either the populated fields or `"none found"`.
- [ ] Wire `whyCommand` (citty `defineCommand`), args matching `RunWhyInput`'s flag set, following `traceExplainCommand`'s exact arg-definition style (`args: { sessionId: {...}, project: {...}, ... }`).
- [ ] Register in `apps/cli/src/main.ts`: add the import line alongside the other command imports (alphabetical position matching the file's existing sort), add `why: whyCommand` to the `subCommands` object.
- [ ] GREEN: `pnpm --filter @megasaver/cli exec vitest run test/commands/why.test.ts` — expect ALL new tests PASS.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run` (full CLI suite) — expect zero regressions in `trace/explain` or `savings/*` tests (Tasks 2-3 touched their files).
- [ ] Commit:

```bash
git add apps/cli/src/commands/why.ts apps/cli/src/main.ts apps/cli/test/commands/why.test.ts
git commit -m "feat(cli): add mega why — raw-vs-delivered forensics for one tool output"
```

---

### Task 5: Dependency-graph check, `--json` failure-path coverage, full verification, changeset, wiki

**Files:**
- Modify: `apps/cli/test/json-failure-paths.test.ts` (add `mega why` cases, per the repo's existing convention referenced in `wiki/entities/cli.md`)
- Modify: `apps/cli/test/dependency-graph.test.ts` (confirm no new edge needed — `why.ts` only uses already-allowed packages; this task VERIFIES that, it should require no edit)
- Create: `.changeset/mega-why-forensics.md`
- Modify: `wiki/log.md`

**Steps:**

- [ ] Read `apps/cli/test/json-failure-paths.test.ts` to find its existing per-command pattern, then add `mega why`'s failure-path cases (unknown project, invalid session id, invalid `--index`) in the same style.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts` — confirm it PASSES with no edit needed (every import `why.ts` uses — `@megasaver/output-filter`, `@megasaver/core`, `@megasaver/context-gate`, `@megasaver/shared` — is already on the allow-list per the investigation). If it fails, that means an import path assumption from Task 4 was wrong; fix the import to use an already-allowed package before touching the allow-list itself (adding a new edge should be a deliberate, separately-justified decision, not an accidental side effect of this feature).
- [ ] Run the full monorepo gate:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
pnpm verify
```

- [ ] Confirm all Turbo tasks green (record the observed pass count).
- [ ] Create the changeset `.changeset/mega-why-forensics.md`:

```markdown
---
"@megasaver/cli": minor
"@megasaver/output-filter": patch
---

Add `mega why <sessionId> --project <name>` — a single-command
raw-vs-delivered forensic view for one tool output: what ranking
kept, what it dropped (with the actual raw text of dropped ranges
fetched from the existing chunk store), and the matching savings
event receipt. Composes three already-shipped data sources; adds no
new persistence or schema.
```

- [ ] Append a timestamped `wiki/log.md` entry: the four-lookups-by-hand problem this replaces, what was built, verification evidence.
- [ ] Final commit:

```bash
git add apps/cli/test/json-failure-paths.test.ts .changeset/mega-why-forensics.md wiki/log.md
git commit -m "test(cli): mega why json-failure-path coverage; changeset + wiki"
```
