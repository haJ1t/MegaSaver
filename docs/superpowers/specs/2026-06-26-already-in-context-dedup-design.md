---
feature: already-in-context-dedup
date: 2026-06-26
risk: HIGH
status: approved-design
reviewers: [code-reviewer, critic]
---

# Already-in-Context Dedup — Design Spec

## Problem

Within a single session the model is repeatedly billed for identical
text. The shipped diff-on-reread optimization (`unchangedResult` in
`run.ts`) only catches a *whole-file re-read* of the *same path* whose
content hash is unchanged. It does nothing for the common overlapping
cases:

- `proxy_search_code` (grep) returns a block, then `proxy_read_file`
  returns a window that contains that same block.
- Two different reads/commands surface the exact same excerpt text.
- The same excerpt is returned by a command and later by a read.

Each of these re-ships text the model already has in context, paying
input tokens twice for zero new signal.

## Goal

Per-session, cross-source, per-excerpt dedup. When MegaSaver is about
to return an excerpt whose **exact text** (sha256 of `excerpt.text`)
was already returned to the model earlier in the **same session**
(from any read OR command/grep), suppress that excerpt inline and
reference the prior chunk-set instead, so the model is not billed
twice for identical text. This generalizes whole-file diff-on-reread
to per-excerpt, cross-source granularity while leaving diff-on-reread
itself untouched.

Success criteria:

1. First occurrence of an excerpt text this session is returned
   normally and recorded.
2. A later exact-text repeat (any source) is dropped from the returned
   excerpts and references the first chunk-set id.
3. Grep-then-read overlap on identical text is deduped.
4. Nothing is suppressed when there is no prior exact hit.
5. The suppressed text is always recoverable via the referenced prior
   `chunkSetId` (evidence-preserving, lossless expand).
6. All four per-excerpt pipelines (registry read, overlay read,
   registry exec, overlay exec) share ONE per-session `shown-index` so
   the overlap is caught regardless of which of those four sources ran
   first. The overlay PostToolUse hook path
   (`recordAndFilterOverlayOutput`, whole-output, not per-excerpt) is a
   KNOWN, documented coverage gap — see Component 7.

## Non-Goals (YAGNI)

- No cross-session sharing. Per-session only; cross-session is a
  separate feature (#4 cross-session diff-on-reread).
- No near-duplicate / fuzzy matching. Exact sha256 equality only.
- No eviction, TTL, or size cap on `shown-index`.
- No change to ranking/scoring.
- No change to diff-on-reread or its `read-index.json` schema.
- No new `FilterDecision` variant (reuse the existing decision).
- No new content-store PERSISTED shape (chunk-sets persist as today,
  with full excerpts, before dedup). NOTE: content-store DOES get a
  small surface change — a `SHOWN_INDEX_FILENAME` constant + a skip line
  in its two dir-enumeration loops (Component 6). That is required so
  enumeration does not crash on the new sibling file; it changes no
  persisted chunk-set shape.

## Locked Decisions (transcribed)

1. **Feature.** Per-session "already-shown content" dedup. When about
   to return an excerpt whose exact text was already returned to the
   model earlier in the SAME session (from any read OR command/grep),
   suppress that excerpt and reference the prior chunk-set instead, so
   the model is not billed twice for identical text. Generalizes the
   shipped whole-file diff-on-reread to per-excerpt, cross-source
   granularity.

2. **Storage.** A NEW per-session sibling index file
   `shown-index.json` in the same session dir as `read-index.json`
   (registry: `<storeRoot>/content/<projectId>/<sessionId>/`; overlay:
   `<storeRoot>/content/<workspaceKey>/<liveSessionId>/`). Shape:
   `Record<excerptTextSha256, { chunkSetId: string }>` — the
   `chunkSetId` where that text was FIRST shown. Do NOT overload or
   modify `read-index.json` (keep diff-on-reread untouched). Atomic
   write, best-effort, never throws — mirror `read-index.ts` patterns
   (`hashContent`, `atomicWriteFile`; load returns `{}` on
   missing/corrupt).

3. **Granularity.** Per-EXCERPT, exact-text match only (sha256 of
   `excerpt.text`). NO fuzzy/near-dup. Conservative: suppress only on
   exact hash equality.

4. **Where.** In BOTH `packages/context-gate/src/run.ts` pipelines
   (`runOutputPipeline` registry + `runOverlayOutputPipeline` overlay)
   AND the exec path
   `packages/context-gate/src/run-command.ts` (`proxy_run_command` /
   `proxy_search_code`). All pipelines share ONE per-session
   `shown-index` so grep-then-read overlap is caught. The dedup step
   runs AFTER `filterRaw`/`filterOutput` produces excerpts AND AFTER
   the chunk-set is persisted (so a reference always resolves), but the
   SUPPRESSION of excerpt text must be reflected in what is RETURNED to
   the model.

5. **Returned shape.** Keep the non-suppressed excerpts; drop the
   suppressed ones from the returned `excerpts`. When >= 1 excerpt is
   suppressed, set an optional new field on `FilterOutputResult`:
   `deduped?: { suppressed: number; priorChunkSetIds: string[] }`
   (distinct list), and add a one-line note to `summary` like
   "(N chunk(s) already shown earlier this session — expand <ids> to
   view)". `exactOptionalPropertyTypes`: only set `deduped` when
   `suppressed > 0` (conditional spread). Do NOT add a new
   `FilterDecision` variant unless strictly needed; reuse the existing
   decision.

6. **Evidence-preserving (§1).** Every suppressed excerpt's text
   remains recoverable via the referenced prior `chunkSetId` (it was
   persisted when first shown). NEVER suppress if the referenced prior
   `chunkSetId` is not present in the `shown-index` (only suppress
   exact prior hits). Recording happens AFTER the current chunk-set
   persist, so first-occurrence excerpts always have a resolvable
   `chunkSetId`.

7. **Ordering / first occurrence.** On the FIRST time an excerpt text
   is seen this session it is RETURNED normally and recorded into
   `shown-index` against the CURRENT `chunkSetId`. On a later
   occurrence it is suppressed and references the recorded
   `chunkSetId`.

8. **Scope (YAGNI).** No cross-session sharing (per-session only —
   cross-session is separate feature #4), no near-duplicate detection,
   no eviction/TTL, no change to ranking/scoring, no change to
   diff-on-reread's `read-index`.

## Components

### 1. `shown-index` module — `packages/context-gate/src/shown-index.ts`

A new sibling module to `read-index.ts` (do NOT mutate
`read-index.ts`). Mirrors its best-effort, atomic, never-throw
patterns and reuses `hashContent` and `atomicWriteFile`.

```ts
export type ShownIndexEntry = { chunkSetId: string };
type ShownIndex = Record<string, ShownIndexEntry>; // key = sha256(excerpt.text)

export function shownIndexPath(sessionDir: string): string;        // join(sessionDir, SHOWN_INDEX_FILENAME)
export function loadShownIndex(sessionDir: string): ShownIndex;     // {} on missing/corrupt
export function recordShown(sessionDir: string,
                            entries: ReadonlyArray<{ textHash: string; chunkSetId: string }>): void;
```

- Key is `hashContent(excerpt.text)` (reuse the exported `hashContent`
  from `read-index.ts`; it already sha256-hex's a string).
- `recordShown` loads the current index, sets each `textHash` it does
  NOT already have (first-writer-wins — never overwrite an existing
  first-occurrence `chunkSetId`), and atomic-writes once. Best-effort:
  a failed write just means the next occurrence is a miss; never
  throws.
- ponytail: `recordShown` is load-modify-write (`loadShownIndex` → set
  missing keys → `atomicWriteFile`) with NO cross-process lock.
  `atomicWriteFile` is per-write atomic but gives no read-modify-write
  isolation, so concurrent same-session pipeline calls (parallel tool
  calls — common with frontier agents) can interleave load-A/load-B/
  write-A/write-B and B's write clobbers A's just-added first-occurrence
  row. This is FAIL-OPEN: a dropped row only means a later occurrence
  misses dedup (lost savings), never a false suppression, dangling
  reference, or evidence loss. We ACCEPT last-writer-wins for v1. If
  parallel-call overlap proves to cost real savings, upgrade `recordShown`
  to re-load inside the write and union (merge-on-write) — no lock needed
  because the only conflict is additive key insertion.
- `SHOWN_INDEX_FILENAME = "shown-index.json"` MUST be added to
  content-store (`store.ts`, beside `READ_INDEX_FILENAME` at line 20)
  and exported, then imported by this context-gate module. This is NOT
  optional symmetry — it is forced by Component 6: content-store's
  chunk-set enumeration (`listChunkSets`) crashes on any sibling JSON
  it does not skip, and `shown-index.json` lands in the same session
  dir as the chunk-sets and `read-index.json`. There is exactly one
  definition (in content-store); context-gate imports it so the skip
  list in `store.ts` and the writer in `shown-index.ts` can never
  drift on the filename.
- Record-only access uses bracket index into the `Record` with the
  `// biome-ignore lint/complexity/useLiteralKeys:
  noPropertyAccessFromIndexSignature` pattern already used in the
  codebase.

### 2. Shared dedup step — `dedupShownExcerpts`

One pure helper (in `shown-index.ts` or a tiny adjacent module) used
by all four pipelines after persist:

```ts
export function dedupShownExcerpts(input: {
  sessionDir: string;
  currentChunkSetId: string;          // the chunk-set just persisted
  excerpts: OutputExcerpt[];
}): {
  excerpts: OutputExcerpt[];          // non-suppressed, original order
  suppressed: number;
  priorChunkSetIds: string[];         // distinct, in first-seen order
  recordEntries: { textHash: string; chunkSetId: string }[]; // first-occurrence rows to persist
};
```

Logic:

1. Load `shownIndex = loadShownIndex(sessionDir)` once.
2. For each excerpt in order, compute `h = hashContent(excerpt.text)`.
3. If `shownIndex[h]` exists AND its `chunkSetId` is a non-empty
   string → SUPPRESS: drop from returned excerpts, push its
   `chunkSetId` into `priorChunkSetIds` (dedup distinct).
4. Else (first occurrence this session) → KEEP in returned excerpts,
   and queue `{ textHash: h, chunkSetId: currentChunkSetId }` for
   recording.
   - In-batch dedup: if the same text appears twice within this one
     result, the first is kept+queued; subsequent identical ones are
     suppressed against `currentChunkSetId` (it is being persisted in
     THIS chunk-set, so the reference resolves). This keeps the
     "billed once" guarantee even within a single excerpt list.
5. Return non-suppressed excerpts (original relative order),
   `suppressed` count, distinct `priorChunkSetIds`, and `recordEntries`.

The caller then `recordShown(sessionDir, recordEntries)` so persist of
the current chunk-set strictly precedes the index write.

### 3. Wiring into the four pipelines

The dedup step slots in identically in all four functions, AFTER the
chunk-set is persisted and `result.chunkSetId` is set, and BEFORE the
stats event append / final return. It only runs when
`settings.storeRawOutput` is true (no persisted chunk-set → no
resolvable reference → never suppress, per Decision 6).

- `run.ts → runOutputPipeline` (registry read).
  `sessionDir = join(storeRoot, "content", settings.projectId, sessionId)`
  (already computed at line 95).
- `run.ts → runOverlayOutputPipeline` (overlay read).
  `sessionDir = join(storeRoot, "content", workspaceKey, liveSessionId)`
  (already computed at line 208).
- `run-command.ts → runOutputExecCommand` (registry exec /
  `proxy_run_command`, `proxy_search_code`). Compute
  `sessionDir = join(storeRoot, "content", settings.projectId, sessionId)`
  — this file does not currently import `join` or read/shown-index, so
  add `import { join } from "node:path"` and the shown-index imports.
- `run-command.ts → runOverlayOutputExecCommand` (overlay exec).
  `sessionDir = join(storeRoot, "content", workspaceKey, liveSessionId)`.

> Note vs the task brief: the brief said "both run.ts pipelines +
> run-command.ts". `run-command.ts` contains TWO exec functions
> (registry `runOutputExecCommand` and overlay
> `runOverlayOutputExecCommand`). To actually catch grep-then-read
> overlap in BOTH the registry and the overlay session, the dedup step
> must be wired into all FOUR functions sharing the one per-session
> `shown-index`. The shared helper makes this four 3-line call sites,
> not four implementations.

Per call site, after persist. NOTE: `FilterOutputResult.excerpts` is
declared `readonly OutputExcerpt[]` (output-filter `types.ts:77`), and
`const result = { ...filteredResult }` (run.ts:115 / run.ts:228) infers
that property as readonly — so `result.excerpts = dd.excerpts` would be
a TS2540 ("Cannot assign to 'excerpts' because it is a read-only
property") under the repo's strict config. (`result.chunkSetId = …`
compiles only because `chunkSetId?` is a mutable optional, not
readonly.) The dedup step must therefore RECONSTRUCT the result object
rather than mutate the readonly array property:

```ts
const dd = dedupShownExcerpts({ sessionDir, currentChunkSetId: chunkSetId, excerpts: filteredResult.excerpts });
result =
  dd.suppressed > 0
    ? {
        ...result,
        excerpts: dd.excerpts,
        summary: `${result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
        deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
      }
    : { ...result, excerpts: dd.excerpts };
recordShown(sessionDir, dd.recordEntries);
```

`result` is declared with `let` (it is already reassigned at the persist
site to set `chunkSetId`); the spread builds a fresh object whose
`excerpts` is freshly typed (no readonly-reassign), and `deduped` is
added only when `suppressed > 0` (conditional construction, satisfying
`exactOptionalPropertyTypes`). `dedupShownExcerpts` accepts the readonly
`filteredResult.excerpts` (its `excerpts` param may be typed
`readonly OutputExcerpt[]`) and returns a fresh mutable
`OutputExcerpt[]`. Equivalently, a per-site `let nextExcerpts:
OutputExcerpt[] = dd.excerpts` local plus a single reconstruct works;
do NOT reassign `result.excerpts` in place.

The persisted chunk-set is untouched (it keeps ALL first-occurrence
excerpts so expand stays lossless); only the in-memory returned
`excerpts` is trimmed. The stats event continues to report
`filtered.*` byte/token figures from the pre-dedup filter result;
chunk-counting for `chunksStored` is out of scope (no change), since
the persisted chunk-set is unchanged.

### 4. `FilterOutputResult.deduped` field —
`packages/output-filter/src/types.ts`

Add one optional field:

```ts
deduped?: { suppressed: number; priorChunkSetIds: string[] };
```

`filterOutput` / `filterRaw` do NOT set it (they have no session
context). It is set only by the pipeline dedup step. With
`exactOptionalPropertyTypes`, set it via conditional spread / direct
assignment only when `suppressed > 0`.

### 5. Summary note

Single appended sentence (Decision 5), mirroring the diff-on-reread
note style. It names the count and the distinct prior chunk-set ids so
the model can `proxy_expand_chunk` them. No new `FilterDecision`
variant; the decision stays whatever the filter produced
(`passthrough` / `light` / `compressed`).

### 6. content-store MUST skip `shown-index.json` (required surface change)

This is a CORRECTNESS-CRITICAL change, not optional. The earlier draft's
"no content-store change required" claim was FALSE.

`shown-index.json` is written into the SAME session dir as the
chunk-sets and `read-index.json` — registry
`<storeRoot>/content/<projectId>/<sessionId>/`, overlay
`<storeRoot>/content/<workspaceKey>/<liveSessionId>/`.
`content-store/src/store.ts → listChunkSets` (lines 117-121) iterates
every `*.json` in that dir, skips ONLY `READ_INDEX_FILENAME`, then
calls `parseExistingFile`, which THROWS
`ContentStoreError("store_corrupt")` on any JSON that is not a valid
chunk-set (store.ts:60-75). `shown-index.json` is a
`Record<hash, { chunkSetId }>`, not a chunk-set, so `listChunkSets`
would throw on it.

`listChunkSets` is the backbone of `mega_recall`:
`mcp-bridge/src/tools/recall.ts:47` and
`daemon/src/handlers-registry.ts:76` both call it and NEITHER catches.
Because `read.ts:67` defaults `storeRawOutput` to `true`, the
shown-index is written on the first read/exec of a session — so the
very next `mega_recall` would throw `store_corrupt`. (The
`pruneOlderThan` GC loop at store.ts:242-251 already tolerates non
chunk-set JSON via try/catch + `continue`; `listChunkSets` does not.)

FIX (required): in `content-store/src/store.ts` add
`export const SHOWN_INDEX_FILENAME = "shown-index.json";` next to
`READ_INDEX_FILENAME` (line 20), export it from `index.ts`, and add a
skip line `if (name === SHOWN_INDEX_FILENAME) continue;` right after the
existing `READ_INDEX_FILENAME` skip in BOTH loops — `listChunkSets`
(after store.ts:119) and `pruneOlderThan` (after store.ts:244). The
context-gate `shown-index.ts` module imports the constant from
content-store (single definition; the skip list and the writer can
never drift on the filename).

A regression test in `@megasaver/content-store` MUST cover it: write a
real chunk-set plus a `shown-index.json` into a session dir and assert
`listChunkSets` returns the chunk-set summary and does NOT throw.

### 7. Overlay hook path coverage — `recordAndFilterOverlayOutput`

The four functions wired in Component 3 are NOT the only path that puts
overlay content in front of the model. The overlay daemon's PRIMARY
output-capture entrypoint is
`context-gate/src/record-output.ts → recordAndFilterOverlayOutput`
(line 89), invoked by the PostToolUse hook via the daemon
`excerptHandler` (`daemon/src/handlers.ts:42`) — NOT
`runOverlayOutputPipeline`. It persists overlay chunk-sets into the
SAME `(workspaceKey, liveSessionId)` dir via `saveOverlayChunkSet`
(record-output.ts:149).

Decision (locks success criterion #6): the overlay hook path is
**out of dedup coverage in this feature** and is explicitly documented
as such. Rationale:

- `recordAndFilterOverlayOutput` does not produce per-excerpt
  `OutputExcerpt[]`. It persists ONE chunk (`id: "0"`, the whole
  redacted output) and returns `returnedText`, not `excerpts`
  (record-output.ts:102-150). The dedup feature is defined per-excerpt
  (Decision 3); there are no excerpts to suppress here, and suppressing
  whole-output chunks against the per-excerpt index is a different,
  out-of-scope mechanism.
- It still WRITES into the shared session dir, so it is NOT excluded
  from being a future reference target. It is simply not, in this
  feature, a dedup *consumer* or per-excerpt *recorder*.

Consequence for success criterion #6: amended to "all FOUR per-excerpt
pipelines (registry/overlay read + registry/overlay exec) share ONE
per-session `shown-index`." The hook-captured whole-output path
(`recordAndFilterOverlayOutput`) is named as a KNOWN coverage gap, to be
folded in only if a later feature gives it per-excerpt granularity. This
keeps the feature honest: we do not claim cross-source dedup we do not
deliver.

> ponytail: wiring `recordAndFilterOverlayOutput` would require either
> teaching it to emit per-excerpt chunks (a record-output refactor) or
> a second whole-output index — both are larger than this feature.
> Scope it out, document it, revisit if the overlap proves real.

## Data Flow

```
read/exec  → filterRaw / filterOutput  → excerpts produced
           → persistChunkSet / saveChunkSet (FULL excerpts persisted)   [reference target exists]
           → set result.chunkSetId
           → dedupShownExcerpts(sessionDir, chunkSetId, result.excerpts):
                load shown-index
                per excerpt: sha256(text) ∈ shown-index & has chunkSetId?
                  yes → suppress, ref prior chunkSetId
                  no  → keep, queue (textHash → current chunkSetId)
           → result.excerpts := kept; result.deduped (if suppressed>0); summary note
           → recordShown(sessionDir, firstOccurrenceEntries)            [AFTER persist]
           → appendEvent (unchanged figures)
           → return result (trimmed excerpts + deduped + note)
```

First occurrence path: not in index → returned + recorded against the
current (just-persisted) chunk-set. Later occurrence path: in index →
suppressed + referenced. Diff-on-reread still short-circuits whole-file
re-reads BEFORE this step (line 103/216 in `run.ts`); the two
mechanisms compose and never both fire on the same call.

## Evidence / Lossless Guarantee (§1)

- The chunk-set persisted on the call that FIRST showed an excerpt
  contains that excerpt's full text. `shown-index` maps the text hash
  to that chunk-set id. A later suppression references it, and
  `proxy_expand_chunk(<priorChunkSetId>, …)` returns the original
  text. Nothing the model could need is destroyed.
- Suppression NEVER happens unless the referenced `chunkSetId` is
  present in `shown-index` (Decision 6). The index is only written
  AFTER a successful persist, so any recorded `chunkSetId` is
  guaranteed to be a real, expandable chunk-set.
- When `storeRawOutput` is false there is no persisted chunk-set;
  dedup is skipped entirely (no reference could resolve), so we never
  suppress into a dangling reference.
- The persisted chunk-set is read-only to this feature — we trim only
  the in-memory returned `excerpts`. Expand is therefore unchanged and
  lossless.

## Error Handling

Best-effort, never throw, never break a read/exec (mirrors
`read-index.ts`):

- `loadShownIndex` returns `{}` on any read/parse error → on a load
  failure nothing matches → nothing suppressed (we return the full
  excerpts). Fail-open toward MORE evidence, never less.
- `recordShown` swallows write errors (try/catch, no rethrow). A
  failed record just makes the next occurrence a miss; correctness of
  the read/exec is unaffected.
- A corrupt or partially-written `shown-index.json` degrades to "no
  prior hits", never to a bad suppression — because suppression
  requires a present, non-empty `chunkSetId` value.
- The dedup step itself must not be able to fail the pipeline: any
  unexpected throw inside it is caught and treated as "no dedup this
  call" (return original excerpts). The pipeline's existing
  `store_write_failed` branches are NOT extended to `shown-index`
  failures — the shown-index is advisory, not load-bearing storage.

## Testing Strategy (Vitest, TDD — red first)

### Unit — `shown-index.ts`
- `loadShownIndex` returns `{}` for a missing file and for corrupt
  JSON.
- `recordShown` atomic-writes; reloading returns the recorded entries.
- `recordShown` is first-writer-wins: re-recording an existing
  `textHash` does NOT overwrite the original `chunkSetId`.
- `recordShown` swallows a write error (inject a failing
  `atomicWriteFile` / unwritable dir) and does not throw.

### Unit — `dedupShownExcerpts`
- Nothing suppressed when the index is empty → returns all excerpts,
  `suppressed === 0`, `deduped` unset by caller, full `recordEntries`.
- An exact-repeat excerpt (text already in index against
  `chunkSetId=A`) is suppressed and `priorChunkSetIds` contains `A`;
  remaining distinct excerpts are kept in order.
- First occurrence is returned AND queued in `recordEntries` against
  the current chunk-set id.
- In-batch duplicate (same text twice in one excerpt list): first
  kept, second suppressed against the current chunk-set id;
  `priorChunkSetIds` includes the current id; distinctness holds.
- No suppression when the matched entry's `chunkSetId` is missing/empty
  (defensive: corrupt row).

### Unit — `@megasaver/content-store` enumeration skip (Component 6)
- Write a valid chunk-set AND a `shown-index.json` into one session dir;
  `listChunkSets` returns the chunk-set summary and does NOT throw
  `store_corrupt`. (Red first: this test fails before the skip line is
  added.)
- `pruneOlderThan` over a dir containing `shown-index.json` does not
  delete it and does not throw.

### Integration — pipelines (inject `now`/`newId`, temp `storeRoot`)
- `runOutputPipeline` (registry read): read file A → excerpts returned
  + recorded; second read of an overlapping window whose excerpt text
  exactly matches → that excerpt suppressed, references first
  chunk-set id, `result.deduped.suppressed >= 1`, summary note present,
  persisted chunk-set of the first read still contains the text (expand
  lossless).
- `runOverlayOutputPipeline` (overlay read): same scenario under
  overlay keys; shares the overlay `sessionDir` shown-index.
- `runOutputExecCommand` (registry exec): `proxy_search_code` returns a
  block (recorded), then a read of the same text via
  `runOutputPipeline` in the SAME session suppresses it — proves the
  ONE shared per-session `shown-index` catches grep-then-read overlap
  across the read and exec paths.
- `runOverlayOutputExecCommand` (overlay exec): grep-then-read overlap
  deduped under overlay keys.
- Nothing suppressed when there is no prior (single fresh read/exec).
- `storeRawOutput = false` → dedup skipped, no `shown-index.json`
  written, full excerpts returned.
- Diff-on-reread still wins for an unchanged whole-file re-read (the
  shown-index step is never reached on that branch).

### Compliance
- `apps/cli/test/readme-proxy-mode.test.ts` stays green (do not touch
  README's pinned lines).

## Risk

HIGH (§12): compression core + read AND exec paths + per-session
session storage. Evidence-preserving and lossless expand are
mandatory. Reviewer set: `code-reviewer` AND `critic` (separate
passes), per §12 HIGH. Author and reviewer never the same active
context.

Specific risk watch-points:
- A suppression that references a non-existent chunk-set would lose
  evidence → guarded by "record only after persist" + "suppress only
  on present non-empty chunkSetId".
- Index write failures must never fail a read/exec → best-effort,
  caught, fail-open.
- Diff-on-reread regression → `read-index.json` and its module are not
  touched; a test asserts the unchanged-marker branch still fires.
- New sibling file crashes `listChunkSets` → `mega_recall` breaks
  (`store_corrupt`). Guarded by the content-store skip line (Component 6)
  + a regression test that enumerates a dir containing
  `shown-index.json`.
- Overlay hook path (`recordAndFilterOverlayOutput`) silently NOT
  deduped → success criterion #6 misclaimed. Guarded by scoping it out
  explicitly (Component 7) and amending criterion #6 to the four
  per-excerpt pipelines only.

## DoD Deltas

- Spec (this file) + plan in `docs/superpowers/plans/`.
- Tests written first (TDD), `pnpm verify` green
  (`biome check` + `tsc --noEmit` + `vitest run`).
- Run `pnpm exec biome check <changed files>` before each commit.
- Smoke evidence: a captured session showing grep-then-read overlap
  deduped with a resolvable expand of the prior chunk-set.
- External reviewer pass (`code-reviewer` AND `critic`) + verifier
  pass.
- Changeset (THREE packages — content-store is now required):
  `@megasaver/output-filter` (minor — new optional `deduped` field),
  `@megasaver/context-gate` (minor — new shown-index module + dedup
  wiring), and `@megasaver/content-store` (minor — exported
  `SHOWN_INDEX_FILENAME` constant + skip line in `listChunkSets` and
  `pruneOlderThan`, per Component 6). The content-store delta is NOT
  optional: without it `listChunkSets` throws `store_corrupt` on the new
  sibling file and breaks `mega_recall`.
- No `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` change (no convention
  change).
- Zero pending TodoWrite items for the feature.

## Resolved Question

Where should `SHOWN_INDEX_FILENAME` live? RESOLVED: it MUST live in
content-store (beside `READ_INDEX_FILENAME`) and be exported. This is
not a taste call — content-store's `listChunkSets` / `pruneOlderThan`
must skip the file to avoid `store_corrupt` (Component 6), so the
filename is owned by content-store and the single definition lives
there. The earlier "keep it in context-gate, smaller blast radius"
default was based on the false premise that content-store needed no
change; that premise is corrected.
