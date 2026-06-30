# M4 — Transcript → memory (deterministic session distillation)

Status: DONE (2026-06-30). Realizes layered-roadmap item 6 ("Transcript →
memory") of [the memory superset
design](./2026-06-30-memory-superset-design.md), **deterministically and with no
LLM** — overriding that spec's "LLM opt-in" framing for this increment. No model
in extraction and none in CI.

## Goal

Distill a recorded session into candidate memories and stage them as
`suggested` for the human approval gate (claude-mem-class session distillation,
the deterministic variant). The human approves later; M3 then surfaces semantic
duplicates at the approve gate. Suggested memories are NOT recallable until
approved (`isRecallable` requires `approved`), so a noisy extractor never leaks
into recall.

## Source of truth (why FailedAttempt, not raw chunk-sets)

A session's RECORDED FAILURES already live in the registry as `FailedAttempt`
rows, keyed by `sessionId`, each with STRUCTURED fields the FORGE path captured
at record time: `task`, `failedStep`, `errorOutput`, `relatedFiles`,
`suspectedCause`. These are exactly the fields a `bug` / `test_behavior` memory
candidate needs.

The alternative — re-parsing the overlay content-store chunk-sets — was
rejected: the `output-filter` parsers (`parseTestOutput`, `parseTsDiagnostic`,
`parseStacktrace`, …) return bare `Chunk[]` (`{ text, startLine, endLine }`),
i.e. classified TEXT with no structured file/symbol/test-name. Turning those
back into structured candidates would re-implement parsing that FORGE already
did when it recorded the failure. So the extractor reads the structured
`FailedAttempt` rows; the parsers stay where they already run (at record time).

## Extractor (pure, in core)

`extractSessionMemories(input) -> ExtractedCandidate[]` in
`packages/core/src/session-memory.ts`. Pure, deterministic, no I/O, no clock —
the caller passes everything in.

Input: `{ sessionId, projectId, failedAttempts: readonly FailedAttempt[] }`
(the caller pre-filters `listFailedAttempts(projectId)` to this session).

Heuristics (deterministic, over already-structured data):

1. Each `FailedAttempt` for the session → one candidate:
   - `type`: `test_behavior` when the failure looks test-shaped (its
     `failedStep`/`errorOutput` matches a small test/assertion regex), else
     `bug`. (One coarse, deterministic classifier; never an LLM.)
   - `title`: derived from `failedStep` (the short label of what broke),
     truncated to the title bound.
   - `content`: a deterministic summary — `failedStep`, the first line of
     `errorOutput`, and `suspectedCause` when present.
   - `source`: `test_failure`.
   - `relatedFiles`: the failure's `relatedFiles` (when non-empty).
   - `sourceFailureId`: the originating `FailedAttempt.id` (used for the
     idempotence key; not stored on the memory).
2. (Optional, simple) explicit decision markers in the failure text — a line
   matching `DECISION:` / `decided to ` in `errorOutput`/`suspectedCause` →
   one `decision` candidate, `source: session_summary`.

Dedupe WITHIN the session by a stable per-candidate `contentHash` (over
`type` + normalized `title` + `content`) so N identical failures collapse to 1.
The candidate also carries a stable `dedupeKey` = `sourceFailureId:contentHash`
for cross-run idempotence (below).

Every candidate maps to `scope: "session"`, `confidence: "low"`,
`approval: "suggested"`. (Low confidence: a machine-proposed candidate is the
least-trusted tier until a human approves.)

## CLI + MCP

- `mega memory from-session <session>` (under the memory group). Resolves the
  store, `getSession(sessionId)` → `projectId`, lists+filters failures, runs the
  extractor, and `createMemoryEntry`s each candidate as `suggested`. Prints
  `suggested=N skipped=M` (or `--json`). Never auto-approves.
- `mega_memory_from_session` MCP tool — same handler shape, input
  `{ sessionId }`, returns `{ suggested, skipped }`. Registered in
  `tool-name.ts` + `server.ts` like `mega_memory_sweep`. No proxy twin, so it
  keeps its name in both naming modes.

## Idempotence (re-run safe, lossless)

Before creating, the command lists the project's existing memories and skips any
candidate whose `dedupeKey` is already represented. The key is recorded
losslessly in the memory's `keywords` as `from-session:<dedupeKey>` (keywords are
already a normalized, searchable surface and survive the schema round-trip). A
second run therefore creates nothing and reports `suggested=0 skipped=N`. Never
deletes.

## Determinism / no-LLM

Pure functions; the only impurity (id + timestamp) is injected via the existing
`newId`/`now` clock and the `MEGA_TEST_*` env pins. No embedding, no model, no
network. CI stays model-free.

## Risk

MEDIUM. Additive: a new pure core module, one CLI subcommand, one MCP tool, one
schema enum entry. No change to the memory data model, the approval gate, the
evidence ledger, or existing FORGE / learn behavior. Suggested-only output is
the safety bound — nothing reaches recall without a human.

## Testing (CI model-free, TDD)

- Extractor: a fixture session with 2 distinct failures + 1 duplicate failure
  (+ optional decision marker) → exactly the right candidates (duplicate
  collapsed), correct `type`/`source`/`relatedFiles`, all `approval: suggested`.
- Command/tool: creates the suggested memories; re-run does NOT duplicate;
  `suggested`/`skipped` counts correct.
- Recall safety: the created `suggested` memories do NOT surface in
  `searchMemoryEntries` / `isRecallable` until approved.
- Time pinned (`MEGA_TEST_NOW`), ids pinned — no wall-clock, no model.
