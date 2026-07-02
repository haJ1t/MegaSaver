---
title: Live Context Seam — Phase 2
date: 2026-07-02
status: approved
risk: MEDIUM-HIGH
scope: read-path hints, overlay capture+hints, memory/conventions hints, benign-exit filter, FILE_PATH precision, seam measurement
base: feat/core-live-context-seam (stacked on PR #211)
reviewers: [code-reviewer, critic]
---

# Live Context Seam — Phase 2

Extends the shipped seam (PR #211) to the paths and hint sources deliberately
deferred there, plus measurement. All wiring facts verified against source
2026-07-02 in the feature worktree.

## Locked decisions

- Stacked on `feat/core-live-context-seam`; merges after #211.
- `recentFiles` hint **deferred with reason**: the read-index stores `pathHash`
  (hashed by design) — file paths are not recoverable; a new session read-log
  store is not justified for a minor boost weight.
- Memory hints use `MemoryEntry.relatedFiles` + `relatedSymbols` only —
  **never** `keywords` or `content` (generic tokens like "api"/"error" would
  over-boost via `fractionMatched`'s `text.includes`; whole content is
  blob-inert, the exact defect class fixed in Slice 2).

## Slices

### P2.1 — read-path hints (registry reads)

`runOutputPipeline` (`context-gate/src/run.ts:72`) has `registry` + `sessionId`
in scope. Build hints there and thread through:

- `filterRaw` (`read.ts:156`) gains an optional `sessionHints` input field
  (same pattern as the existing `outline` option) and passes it + 
  `engineRanking` into `filterOutput` (`read.ts:164`). `read.ts` itself stays
  session-ignorant.
- `runOutputPipeline` calls `buildSessionHints(input.registry, projectId,
  input.sessionId)` once before its `filterRaw` call (`run.ts:113`) and passes
  the result.

Overlay read pipeline (`runOverlayOutputPipeline`, `run.ts:192`) is registry-less
→ gets overlay hints from P2.2's overlay store.

### P2.2 — overlay failure capture + hints

The overlay command path (`run-command.ts:390` `runOverlayOutputExecCommand`)
has no registry. Mirror the existing overlay store discipline (content-store
`content/<workspaceKey>/<liveSessionId>/…`, stats
`stats/<workspaceKey>/<liveSessionId>.events.jsonl`):

- New overlay failure store in `@megasaver/content-store` (or context-gate if
  more natural): `failures/<workspaceKey>/<liveSessionId>.jsonl`, segments
  validated with the existing `assertSafeSegment` pattern.
- Record shape mirrors `SessionFailure` minus registry ids:
  `{command (redacted), errorOutput (redacted, 4000 cap), source:
  'proxy-classifier', createdAt}`.
- **No session-end signal exists on the overlay path** → bound the store by
  count: keep the most recent `MAX_OVERLAY_FAILURES = 50` records
  (rewrite-on-append trim). No TTL daemon.
- Capture trigger identical to the registry path (non-zero exit / terminated),
  including the benign-exit filter (P2.4) and redaction (reuse the registry
  path's exact treatment).
- `runOverlayOutputExecCommand`'s `filterOutput` call (`run-command.ts:426`)
  gets `sessionHints` built from this store (same `extractFailureSignatures`)
  + `engineRanking`.
- `runOverlayOutputPipeline` (reads) gets the same overlay hints.

### P2.3 — memory + conventions hints

Extend `buildSessionHints` (`context-gate/src/session-hints.ts`):

- `recentMemory` ← for the session's project: recallable, non-stale, approved
  memory entries' `relatedFiles` + `relatedSymbols` tokens (dedup, cap 12 —
  same cap discipline as failures). Selection via the registry (the
  `OrchestratorRegistry` port widens with a narrow read method, or reuse an
  existing list method — plan decides from real registry API).
- `projectConventions` ← `ProjectRule.appliesTo` path/glob tokens of the
  project's rules (dedup, cap 12).
- `fractionMatched` in `output-filter` is untouched — the tokens are short and
  specific by construction.
- Overlay path: no registry → memory/conventions hints stay registry-path-only
  (documented).

### P2.4 — benign-exit capture filter

At both capture sites: skip capture when `childExitCode === 1 &&`
redacted `errorOutput` is empty. Rationale: grep/rg/test/diff no-match
convention — exit 1 with no output carries zero failure evidence (it already
contributes zero signatures; this stops the disk noise too). Any other exit
code, or exit 1 **with** output, still captures.

### P2.5 — FILE_PATH signature precision

`extractFailureSignatures` (`session-hints.ts:13`): FILE_PATH matches gain an
extension allowlist — common code/config extensions (`ts tsx js jsx mjs cjs py
go rs java rb c h cpp hpp cs swift kt json yml yaml toml sql sh`) — so
`README.md`, `example.com`, `a.b` stop producing signatures. ERROR_CODE regex
unchanged. Existing tests updated only where they asserted the old over-match.

### P2.6 — seam measurement (`mega audit seam`)

All the data already exists in `RankingTrace` (per-chunk `EngineScore` with
`failureHistoryBoost`/`memoryBoost`) — but `recordTrace` is never enabled in
production and no reader exists.

- The two registry-path seam call sites (`runOutputExecCommand`,
  `runOutputPipeline`) enable `recordTrace: true` and append the returned trace
  via the existing `writeReplayTrace` to
  `store.root/stats/<projectId>/<sessionId>.traces.jsonl` (best-effort, like
  the existing writer). Overlay sites excluded for now (keep scope bounded).
- New reader in `@megasaver/output-filter` (or stats): parse a traces JSONL →
  `ReplayTrace[]`.
- New CLI command `mega audit seam` (mirror `audit/report.ts` structure):
  reports per session/project — traces analyzed, % of outputs where
  `failureHistoryBoost > 0` fired, ditto `memoryBoost`, mean boost when fired,
  hint counts, session-failure capture count, tokens before/after.
- **A/B switch**: the seam call sites stop hardcoding `engineRanking: true` and
  instead pass `engineRanking: !engineRankingDisabledByEnv()` — i.e. on by
  default, but `MEGASAVER_ENGINE_RANKING=false` disables (the env resolver at
  `rank.ts:127-137` gains an explicit-false form). Lets an operator run
  seam-off sessions and compare `audit seam` output.

## Non-goals

`recentFiles` hint (no path data), overlay memory hints (no registry), overlay
trace recording, TTL-based overlay pruning (count cap suffices), any change to
`fractionMatched` weighting, new stats event kinds (traces suffice).

## Testing

TDD per slice. Key non-tautology requirements:
- P2.1/P2.2: integration — prior failure on the same path raises a later
  chunk's rank (mirror the Slice-2 realistic test), one per path.
- P2.2: overlay store trims to 50; segments validated.
- P2.3: memory with `relatedFiles: ['src/auth.ts']` boosts a later chunk
  mentioning `src/auth.ts`; a memory with only generic keywords contributes
  nothing (mutation: switching source to keywords must fail the test).
- P2.4: exit 1 + empty output → no record; exit 1 + output → record; exit 3 +
  empty → record.
- P2.5: `README.md`/`example.com` produce no signature; `src/auth.ts:42` does.
- P2.6: a session with a seam-boosted output → `audit seam` reports non-zero
  fire rate; `MEGASAVER_ENGINE_RANKING=false` session → zero fire rate and
  traces record `engineRanking: false`.

`pnpm verify` green at every slice boundary; code-reviewer + critic before PR.
