# Stats Wiring Completion — Design

- **Date:** 2026-06-10
- **Risk:** MEDIUM (orchestrator surface + CLI output change; no security-sensitive code)
- **Status:** approved (user directive: proceed per recommended roadmap, 2026-06-10)
- **Sources:** wiki/entities/stats.md (wiring audit 2026-06-10), wiki/syntheses/post-v1.1-roadmap.md item 3

## §1 Problem

The token-saver stats ledger (`@megasaver/stats`) shipped in BB6 and was
wired into the exec path in BB7b (`runOutputExecCommand` →
`appendEvent`, `packages/context-gate/src/run-command.ts:277`). Two gaps
remain (code audit 2026-06-10):

- **Gap A:** `runOutputPipeline` (file-read orchestrator,
  `packages/context-gate/src/run.ts`) records no `TokenSaverEvent`.
  File reads through `mega output file`, `mega output filter`, and the
  MCP `mega_read_file` tool are invisible to savings stats, so the GUI
  chart and session summary undercount.
- **Gap B:** `mega session saver stats` never reads the stats store. It
  prints a stale notice (`BB6_NOTICE = "Event stats (bytes saved per
  call) arrive with BB6."`) and hardcodes `eventStats: null` in `--json`
  (`apps/cli/src/commands/session/saver/stats.ts:10,67,80`), although
  the data exists on disk and the GUI already renders it.

## §2 Goals / Non-goals

**Goals**

1. Every successful `runOutputPipeline` run appends a `TokenSaverEvent`
   (`sourceKind: "file"`), exactly mirroring the exec path's semantics.
2. `mega session saver stats` reports the real
   `SessionTokenSaverStats` summary in both text and `--json` modes.

**Non-goals**

- No new stats fields, no event schema change.
- No GUI change (GUI already reads summary + events).
- No `fetch`/`grep` source kinds (no production path produces them yet).
- No npm-publish or skill-packs work (separate roadmap items).

## §3 Design

### §3a Gap A — event wiring in `runOutputPipeline`

Mirror `run-command.ts`:

1. After filtering (and optional chunkSet persistence), build a
   `TokenSaverEvent`:
   - `sourceKind: "file"`, `label: input.path`
   - `rawBytes` / `returnedBytes` / `bytesSaved` / `savingRatio` /
     `summary` from the filter result
   - `chunkSetId` only when `storeRawOutput` persisted one
   - `mode: settings.mode`, ids/timestamps via injectable
     `newId`/`now` (existing defaults)
2. Call `appendEvent({ store: { root: input.storeRoot }, event,
   secretsRedacted, chunksStored: excerpts.length })`.
   `secretsRedacted` is parsed from filter warnings with the same
   helper the exec path uses.
3. **Shared helpers:** move `redactedCount` (and `messageOf` if needed)
   from `run-command.ts` into a package-internal module
   (`packages/context-gate/src/stats-helpers.ts`); both orchestrators
   import it. No public-surface change.
4. The event is appended on every successful run, regardless of
   `storeRawOutput` — identical to exec-path behavior.

### §3b Gap A — error semantics (decision)

`RunOutputResult` widens with
`{ ok: false; reason: "store_write_failed"; detail: string }`.

- `appendEvent` failure → `store_write_failed` (mirrors exec path).
- `persistChunkSet` is currently unwrapped in `run.ts` (a
  `saveChunkSet` throw escapes as a raw exception — latent
  inconsistency with the exec path). Wrap it in the same try/catch →
  `store_write_failed`. In-scope: same function, same reason code,
  closes an asymmetry on the exact surface this spec touches.

**Alternative considered:** treat stats-write failure as non-fatal
(warn, still return `ok`). Rejected: the exec path already fails hard;
two different failure semantics for the same ledger would be a trap,
and fail-loud matches §13 anti-patterns (no silent swallow).

**Consumers** (exhaustive switches force the update at compile time):

| Consumer | Change |
|---|---|
| `apps/cli/src/commands/output/file.ts` | add `store_write_failed` case → existing `errors.ts:275` message helper |
| `apps/cli/src/commands/output/filter.ts` | same |
| `packages/mcp-bridge/src/tools/read-file.ts` | add case → `McpBridgeError("store_write_failed", detail)` (code already in the 16-member enum) |

### §3c Gap B — real `mega session saver stats`

1. `apps/cli` adds `@megasaver/stats` (workspace) dependency — app may
   depend on leaf packages; §3c cycle rules are unaffected (stats never
   imports core).
2. After the session lookup, call
   `readSummary({ root: rootDir }, session.projectId, sessionId)`.
   `rootDir` from `resolveStorePath` is the same store root the output
   commands write to.
3. **Text mode:** keep the existing settings line. Then:
   - summary exists → render totals: events, raw bytes, returned
     bytes, bytes saved, saving ratio (percent, 1 decimal), secrets
     redacted, chunks stored, updated-at.
   - no summary file → `No events recorded yet.`
   - Delete `BB6_NOTICE`. Intentional byte-compat break, documented
     here (precedent: T6 full symmetry, PR #48).
4. **`--json` mode:** `eventStats` becomes
   `SessionTokenSaverStats | null` (real summary, or `null` when no
   events). Key name and `null`-when-absent semantics preserved, so
   the existing shape is a strict widening.
5. `StatsError("store_corrupt")` propagates to the existing
   `mapErrorToCliMessage` catch (text stderr, exit 1) — same failure
   policy as every `--json` command (12 enforcement tests pattern).
   If the generic mapping is unreadable, add a `StatsError` branch in
   `errors.ts` during implementation.

## §4 Testing (TDD targets)

- **context-gate** (`packages/context-gate/test/run.test.ts`):
  - successful run appends one event line to
    `<store>/stats/<projectId>/<sessionId>.events.jsonl` and updates
    the summary JSON (assert via `readSummary`).
  - event fields: `sourceKind: "file"`, `label` = input path,
    metrics match the filter result; `chunkSetId` present iff
    `storeRawOutput`.
  - `storeRawOutput: false` → still appends the event, no chunkSet.
  - redaction warnings → `secretsRedactedTotal` increments.
  - `appendEvent` throw → `{ ok: false, reason: "store_write_failed" }`.
  - `saveChunkSet` throw → same (closes the unwrapped-persist gap).
- **cli** (`apps/cli/test/session/saver-stats.test.ts` + output tests):
  - stats after recorded events → text totals; `--json` carries the
    full summary object.
  - no events → `No events recorded yet.`; `--json` `eventStats: null`.
  - existing assertions on `BB6_NOTICE` updated/removed.
  - `output file`/`filter` map `store_write_failed` to the canonical
    message.
- **mcp-bridge**: `read-file` maps `store_write_failed` →
  `McpBridgeError("store_write_failed")`.

## §5 Definition of Done

Per CLAUDE.md §9: spec (this file) + plan + TDD + `pnpm verify` green +
smoke evidence (run `mega output file` then `mega session saver stats`
against a temp store; totals non-zero) + external reviewer pass +
changeset (`@megasaver/context-gate` minor — public `RunOutputResult`
union widened; `@megasaver/cli` patch/minor — stats output change) +
wiki update (`entities/stats.md`, `entities/cli.md`, log entry).
