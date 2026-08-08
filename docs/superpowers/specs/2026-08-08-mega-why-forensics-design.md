---
feature: mega-why-forensics
date: 2026-08-08
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "3 of 5 (2026-08-08 self-audit batch)"
---

# `mega why` — one-command raw-vs-delivered forensics for the last failure

## Problem

When a compressed tool result turns out to be misleading — the saver
kept the wrong excerpt, dropped the one line that explained a test
failure, or a "PASS" claim didn't match what the raw log actually
said — today's honest answer to "why did the agent see that?" is
scattered across at least four separate lookups the developer has to
know to chain by hand:

1. Find the session id (`mega session list <project>`).
2. `mega trace explain <sessionId> --project <name> [--workspace <key>]`
   to see the ranking decision (`apps/cli/src/commands/trace/explain.ts`,
   backed by `readSessionDecisionTrace`,
   `packages/output-filter/src/decision-trace.ts:100`).
3. Separately find the `chunkSetId` the trace prints, then
   `mega output chunk <chunkSetId> <chunkId>` per chunk to see the
   raw text that was dropped (`apps/cli/src/commands/output/chunk.ts`,
   backed by `fetchChunk`, `packages/context-gate/src/fetch-chunk.ts:131`).
4. If the concern is a command's exit status specifically, separately
   check `mega verify claims` (spec `2026-08-06-claim-verification-gate-design.md`,
   in-flight elsewhere in this batch) once its `childExitCode` field
   ships on `TokenSaverEvent`.

Every piece of evidence needed already exists on disk — the decision
trace, the redacted raw chunks, the event's `sourceKind`/`label`
(`packages/stats/src/event.ts:47-48`) — but nothing joins them into
one view. A developer debugging "the agent said tests pass but they
didn't" has to already know this product's internal file layout to
reconstruct what happened. This is the same "evidence exists, no
gate reads it" shape the batch-1 `claim-verification-gate` spec
identified for exec receipts (`2026-08-06-claim-verification-gate-design.md`
§Problem) — `mega why` is the READ-side forensic counterpart:
claim-verification-gate proves a text claim against a receipt;
`mega why` shows a human the full raw-vs-delivered picture for one
specific output, on demand, after something already looked wrong.

## Goal

`mega why <sessionId> --project <name> [--tool <n>] [--json]` — the
single command a developer runs right after "wait, that doesn't look
right." For the most recent (or `--tool`-filtered / `--index`-selected)
decision-trace output in that session, print:

- what ranking decided (classification, decision band, compressor —
  reusing `renderDecisionTrace`'s existing per-output line verbatim,
  not a second renderer for the same data);
- the excerpts that were KEPT (line ranges + score, from the trace);
- the excerpts that were DROPPED (line ranges + score, from the
  trace's `omitted` array — currently computed but never rendered by
  `mega trace explain`, which only prints `${o.omitted.length}
  omitted` as a bare count, `explain.ts:49`);
- for every DROPPED range, the actual raw text, fetched via the SAME
  `fetchChunk` the recovery footer already points an agent at — no
  new persistence, no new redaction path;
- the receipt: `sourceKind`/`label`/`rawBytes`/`returnedBytes` and
  (once available) `childExitCode` from the matching `TokenSaverEvent`.

## Non-Goals

- No new persistence, no new schema, no new redaction path. `mega
  why` is a pure READ composition over three already-shipped, already-
  reviewed data sources (`readSessionDecisionTrace`, `fetchChunk`,
  the stats event stream) — if a source's data does not exist for
  this session (seam trace disabled, chunk pruned, no matching
  event), the command reports that gap honestly, it does not
  fabricate or reconstruct.
- No judgment, no "this compression looks wrong" heuristic, no
  automatic flagging — same honest-metrics discipline as
  claim-verification-gate: report evidence, let the human judge.
- No coupling to `claim-verification-gate`'s `childExitCode` field
  work — if that field is absent (pre-C3 event, or C3 not yet
  merged), `mega why` renders `exitCode: unrecorded` and proceeds;
  it never blocks on or duplicates that other pair's schema change
  (cross-batch ownership: C3 owns `childExitCode` per
  `wiki/log.md`'s 2026-08-08 batch-lock entry — this spec is
  consume-only on that field, exactly like every other wave-2 pair
  the lock note describes).
- No live/overlay-session support in v1 (registry sessions only,
  matching `mega trace explain`'s own current scope — the overlay
  live-first path is a documented follow-up, not silently dropped).
- No terminal UI, no interactive picker — v1 is `--tool`/`--index`
  flags for narrowing, not a TUI (YAGNI; a flag is cheaper to build,
  test, and script around than a picker nobody asked for yet).

## Locked Decisions

1. **`mega why` is a NEW top-level command, not a `trace explain`
   flag.** `trace explain` is a session-wide, all-outputs overview by
   design (its own doc comment: "explain a session's recorded causal
   chain"); `mega why` is a single-output, evidence-attached deep
   dive. Folding raw-chunk-fetching into `trace explain` would change
   that command's existing output contract (and its `--json` shape,
   which downstream tooling may already parse) for every caller, not
   just the forensic one. A new command has its own contract from
   day one.
2. **Output selection: newest output by default, `--index N`
   (0-based, matches `trace.outputs[N]`) or `--tool <name>` (last
   matching output) to pick another.** No new sorting/filtering
   logic — `readSessionDecisionTrace`'s `outputs` array is already in
   creation order (per `decision-trace.ts:27-30`'s type, appended as
   `finalizeReplayTrace` calls arrive); "newest" is simply the last
   element.
3. **Dropped-excerpt text is fetched through `fetchChunk`, keyed by
   the trace's own `chunkSetId` (`DecisionOutput.chunkSetId`,
   `decision-trace.ts:15`) and each omitted range's chunk id.** A
   chunk set stores fixed-size line-range chunks
   (`OVERLAY_CHUNK_LINES = 40`, `packages/context-gate/src/recovery-footer.ts:4`);
   `mega why` maps an omitted `{startLine, endLine}` to the covering
   chunk id(s) using the exact same arithmetic the recovery footer
   already uses to advertise `i = 0..N-1` ranges to an agent — reused,
   not reimplemented (Task 1 locates and reuses that helper rather
   than re-deriving the chunk-index math from scratch).
4. **Missing evidence renders as an explicit gap line, never a
   silent omission.** Three independently-possible gaps, each with
   its own honest label: `chunkSetId` absent on the output → `"raw
   text: not recoverable (no chunk set recorded for this output)"`;
   `fetchChunk` returns `chunk_set_not_found`/`chunk_not_found`
   (pruned by retention GC, `packages/context-gate/src/retention-prune.ts`,
   or evidence GC) → `"raw text: no longer available (pruned)"`;
   no matching `TokenSaverEvent` for this trace's `(sessionId,
   createdAt, toolName)` → `"receipt: none found"`. Never a thrown
   error for a normal, expected absence.
5. **Event matching is best-effort correlation, not a foreign key.**
   `DecisionOutput` and `TokenSaverEvent` are written by different
   code paths at slightly different times and carry no shared id
   today (confirmed: `DecisionOutput` has no `eventId`/`chunkSetId`↔
   event linkage beyond the shared `chunkSetId` string, which IS
   present on `TokenSaverEvent.chunkSetId` per `event.ts:59` — this
   is therefore the join key, not toolName/timestamp proximity,
   wherever `chunkSetId` is present on both sides). When the trace's
   `chunkSetId` is null (no chunk set recorded) or matches no
   event, `mega why` reports `receipt: none found` rather than
   guessing via nearest-timestamp — a wrong correlated receipt is
   worse than an honest "none found" for a forensic tool whose whole
   purpose is trustworthy evidence.
6. **Free tier, no entitlement gate.** This reads the same store data
   `mega trace explain` (free) and `mega output chunk` (free) already
   expose individually; composing two free reads into one view adds
   no new business value that would justify a Pro gate, and gating a
   debugging tool would work against the exact trust story this
   session's other spec (`gui-pro-analytics-live-wire`) is fixing.

## Architecture

```
mega why <sessionId> --project <name> [--tool][--index][--json]
  apps/cli/src/commands/why.ts    runWhy(input) -> composes:
    readSessionDecisionTrace   (@megasaver/output-filter, existing — same call trace/explain.ts already makes)
    chunkIndexForLineRange     (new, small pure fn — packages/output-filter/src/decision-trace.ts, reuses recovery-footer's chunk-index arithmetic)
    fetchChunk                 (@megasaver/context-gate, existing — same call output/chunk.ts already makes)
    readEvents                 (@megasaver/core, existing — same call savings/shared.ts's defaultSavingsEventReader already makes)
```

No new package, no new workspace dependency edge — `apps/cli` already
depends on `@megasaver/output-filter`, `@megasaver/context-gate`
(re-exported via `@megasaver/core`), and `@megasaver/core` itself.
`why.ts` is composition-only, following the exact shape
`trace/explain.ts` already establishes (store resolve → session id
parse → registry lookup → reader call → render).

## Components

1. **`chunkIndexesForLineRange(startLine, endLine): number[]`** (new,
   exported from `packages/output-filter/src/decision-trace.ts` — the
   file that already owns `DecisionOutput`/`readSessionDecisionTrace`,
   so the new helper lives beside the type it serves) — given
   `OVERLAY_CHUNK_LINES = 40` (imported from `@megasaver/context-gate`,
   confirm this constant's actual export path before finalizing the
   import — it may need a small re-export addition if not already on
   `context-gate`'s public `index.ts`), returns every chunk index `i`
   whose `[i*40, (i+1)*40)` line range intersects `[startLine,
   endLine]`. Pure arithmetic, unit-testable without any store I/O.
2. **`runWhy(input): Promise<0 | 1>`** (new,
   `apps/cli/src/commands/why.ts`) — mirrors `runTraceExplain`'s
   structure exactly (store resolve, project lookup, session id
   parse, workspace-key optional flag for the same evidence-join
   `trace/explain.ts` already supports) through the point of loading
   `readSessionDecisionTrace`; then:
   a. select the target `DecisionOutput` per Locked Decision 2;
   b. for each `omitted` entry, compute chunk indexes (Component 1),
      call `fetchChunk` once per unique index, collect ok/gap per
      Locked Decision 4;
   c. read events via the same store-root registry walk
      `defaultSavingsEventReader` already performs (reuse, do not
      re-implement — import path TBD at implementation time: either
      directly from `apps/cli/src/commands/savings/shared.ts`'s
      exported reader or a small extracted shared helper if that file
      is not meant to be imported cross-command — check for an
      existing precedent of one CLI command file importing another's
      exported reader before deciding);
   d. find the event whose `chunkSetId` equals the output's
      `chunkSetId` (Locked Decision 5); render `receipt: none found`
      if absent.
3. **`renderWhy(result): string[]`** (new, same file) — text renderer:
   reuses `renderOutput`'s existing per-output summary line (import
   from `trace/explain.ts`'s exported `renderDecisionTrace` internals
   — check whether `renderOutput` itself is exported or only
   `renderDecisionTrace`; if only the latter, either export the inner
   `renderOutput` function or accept a small, deliberate one-line
   duplication of that single summary line rather than a larger
   refactor — note the choice made in the implementation, do not
   silently diverge the two renderers' wording), then appends a KEPT
   section, a DROPPED section (range + score + fetched text, or the
   gap label), and a RECEIPT section (sourceKind/label/bytes/
   childExitCode-or-unrecorded, or `receipt: none found`).
4. **`whyCommand`** (citty `defineCommand`, same file) — args:
   `sessionId` (positional), `--project` (required, matches
   `trace explain`'s convention), `--tool`, `--index`, `--workspace`
   (same optional evidence-join flag `trace explain` has, same
   default-unresolved behavior), `--store`, `--json`. Registered in
   `apps/cli/src/main.ts`'s `subCommands` map as `why: whyCommand`.

## Error handling

- Every "evidence absent" case renders an explicit gap line (Locked
  Decision 4) — the command's own exit code stays 0 for these (an
  expected, honest absence is not a command failure); exit 1 is
  reserved for actual usage errors (bad session id, unknown project,
  bad `--index` out of range) mirroring `trace explain`'s existing
  exit-code conventions exactly (`explain.ts`'s `mapErrorToCliMessage`
  pattern, reused verbatim).
- `fetchChunk` throwing (store-corrupt) is caught per-chunk, not
  session-wide — one corrupt chunk degrades to a gap line for that
  range only; the rest of the report still renders (mirrors
  `checkGeneratedOutputByteVariance`'s "one probe failing never
  crashes the whole report" precedent from `cache-doctor`).
- `--json` failure paths follow the existing repo convention
  (`apps/cli/test/json-failure-paths.test.ts` pattern referenced in
  `entities/cli.md`) — errors are structured JSON on the error path
  too, never a bare text message mixed into a `--json` invocation.

## Security & privacy

- No new data crosses a trust boundary that `mega output chunk`
  doesn't already cross today: chunk text is the SAME redacted,
  stored chunk text `mega output chunk` already prints on request —
  `mega why` fetches it through the identical `fetchChunk` function,
  inheriting its existing redaction guarantee (chunks are built from
  `recoverableChunks(raw)`, which redacts before storing — the
  content was never unredacted on disk to begin with, per
  `packages/context-gate/src/recoverable-chunks.ts`'s own doc
  comment).
- No secret-adjacent new surface: `TokenSaverEvent`'s `label` field
  is already displayed by other free commands; nothing here escalates
  its exposure.

## Testing

| Unit | Test |
|---|---|
| `chunkIndexesForLineRange` | a range fully inside one chunk → `[i]`; a range spanning a chunk boundary → `[i, i+1]`; a range at line 0 → includes index 0; off-by-one at exact chunk boundaries (line 39 vs 40) |
| `runWhy` | selects the newest output by default; `--index` picks the exact array position; `--tool` picks the last matching output; out-of-range `--index` → usage error, exit 1 |
| `runWhy` | omitted-range chunk fetch: seeded chunk set + trace → dropped section contains the real fetched text; a chunk-set-not-found trace → the exact gap label from Locked Decision 4, exit 0 |
| `runWhy` | event correlation: seeded event with matching `chunkSetId` → receipt section populated including `childExitCode` when present on the event, `unrecorded` when the field is absent (pre-C3 fixture) or the event itself is missing entirely (`receipt: none found`) |
| `renderWhy` | KEPT/DROPPED/RECEIPT section ordering and headers are stable (snapshot-style structural assertion, not a byte-exact golden file — repo convention avoids brittle golden-file tests per prior guard-testing lessons) |
| `--json` | emits a single structured object with `kept`, `dropped` (each entry `{ range, score, text | gap }`), `receipt` fields — never mixes text and JSON on the same invocation |

No timing-tight tests; all fixtures are seeded stores + injected
readers (cli-test-pattern).

## Risk & process

**MEDIUM.** Pure read composition over three already-shipped, already-
reviewed data sources; no new persistence, no new mutation path, no
new trust boundary. Required reviewer: `code-reviewer`. Escalation
trigger: if implementation finds it needs a NEW correlation field
beyond the existing `chunkSetId` join (e.g. adding an id to
`DecisionOutput` or `TokenSaverEvent` to make matching more precise),
STOP — that is a schema change belonging to its own spec, not a
silent addition here; report the gap to the user instead of widening
scope. Regression evidence: `mega trace explain` and `mega output
chunk` output are byte-for-byte unchanged (this spec adds a new
command file and, at most, one new exported helper + one export-path
addition; it does not modify either existing command's body).

## Dependencies / build order

Independent of `2026-08-08-gui-pro-analytics-live-wire` (build 1) and
`2026-08-08-planner-office-launch-fix` (build 2) — no shared files.
Soft dependency on the batch-1 `claim-verification-gate` pair's
`childExitCode` field (Non-Goal / Locked Decision 4): if that field
is not yet merged when this pair is implemented, `mega why` ships
with every event rendering `exitCode: unrecorded` and needs NO
follow-up change when `childExitCode` later lands — the field is
read as `event.childExitCode ?? "unrecorded"` from day one, so the
two pairs can land in either order without coordination.
