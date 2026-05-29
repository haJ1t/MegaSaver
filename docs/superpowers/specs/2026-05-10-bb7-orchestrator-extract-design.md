---
title: BB7 — context-gate orchestrator extraction into core (design)
status: proposed
risk: HIGH
created: 2026-05-10
updated: 2026-05-10
parent: 2026-05-10-aa1-context-gate-epic.md
sub-pr: BB7-orchestrator-extract
authority: ../specs/2026-05-10-aa1-context-gate-epic.md  # §2a / §3a / §3c / §8d
---

# BB7 — context-gate orchestrator extraction (design)

> Authority: the AA1 epic spec (`§2a`, `§3a`, `§3c`, `§8d`) is the
> source of truth. This child spec restates the BB7 risk level
> (`HIGH`) per `CLAUDE.md §12` and locks the surgical, behaviour-
> preserving extraction it mandates. Where this spec and the epic
> disagree, the epic wins.

---

## §1 Goal & non-goal

**Goal.** Relocate the context-gate output pipeline — currently
implemented inline under `apps/cli/src/commands/output/` — into
`packages/core/src/context-gate/` as importable, agent-agnostic
functions, so that BOTH the CLI (BB7) and the future MCP bridge
(BB8) drive ONE orchestrator from two entry points (epic §8d, §2a
"one orchestrator, two entry points"). The CLI `mega output`
commands become thin adapters that parse flags, call core, and map
core results to CLI text/JSON + exit codes.

**Behavioural contract.** Byte-identical behaviour. Every existing
test under `apps/cli/test/output/` (`file.test.ts`,
`filter.test.ts`, `chunk.test.ts`, `locate-chunk-set.test.ts`,
`no-child-process.test.ts`) MUST stay green WITHOUT edits to its
assertions. These are the characterization tests for the refactor.

**Non-goals.**

- No new behaviour, no new flags, no new error codes. This is a
  move, not a feature.
- No `exec` / `child_process` work. The `no-child-process.test.ts`
  guard MUST keep passing for the CLI output sources; `exec` is
  BB7b (CRITICAL). The relocated core module likewise spawns
  nothing in BB7.
- No package-graph change beyond what §3c already permits: core may
  depend on `policy`, `output-filter`, `content-store`, `shared`
  (it already does, transitively, via the CLI). Those packages MUST
  NOT gain a dependency on `@megasaver/core`.
- No `enable.ts` / `disable.ts` / `session-policy` mutation logic
  (those are BB2 / BB7a-session concerns). BB7 relocates only the
  read/filter/store output pipeline and the chunk-set locate/fetch
  read path that already exist in `apps/cli/src/commands/output/`.

---

## §2 What moves (current → target)

The logic to relocate lives in five files (verified against the
worktree):

| Current file (`apps/cli/src/commands/output/`) | Responsibility |
|--------------------------------------------------|----------------|
| `shared.ts` | `resolveEffectiveSettings`, `runTwoGates` (policy `evaluatePathRead` → output-filter `resolveSafeReadPath`), `readAndFilter` (`fs.readFile` → `filterOutput`), `persistChunkSet` (`saveChunkSet`), `defaultNow`, `defaultNewId`, the `EffectiveSettings` / `GateResult` / `PipelineEnv` types |
| `file.ts` | `runOutputFile` — flag/Zod parse, store resolve, settings resolve, two-gate, read+filter, conditional persist, text/JSON render |
| `filter.ts` | `runOutputFilter` — same pipeline keyed on `--file` instead of a positional path |
| `chunk.ts` | `runOutputChunk` — `locateChunkSet` → `loadChunkSet` → find chunk → render |
| `locate-chunk-set.ts` | `locateChunkSet` — walk `<store>/content/<projectId>/<sessionId>/<chunkSetId>.json` |

### §2a Pipeline anatomy (the load-bearing sequence)

The orchestrator is the composition currently spread across
`shared.ts` + `file.ts`/`filter.ts`:

```
resolveEffectiveSettings(registry, sessionId)
  → runTwoGates({ path, projectId, projectRoot })   # evaluatePathRead → resolveSafeReadPath
    → readAndFilter({ absolute, path, intent, mode, maxReturnedBytes })  # fs.readFile → filterOutput
      → (if storeRawOutput) persistChunkSet(...)     # saveChunkSet to <store>/content/...
```

and the chunk-set read path currently in `chunk.ts` +
`locate-chunk-set.ts`:

```
locateChunkSet({ storeRoot, chunkSetId })
  → loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId })
    → chunks.find(c => c.id === chunkId)
```

Both sequences move into core wholesale. The ordering of the two
read gates (policy denylist BEFORE the sandbox resolver, both
BEFORE any `fs.readFile`) is a security invariant from epic §8a/§5b
and MUST be preserved exactly — it is what `file.test.ts`'s
`path_denied` / `path_unsafe` / "no read" cases assert.

---

## §3 Target layout in core (epic §3a)

The epic §3a names the context-gate files
`core/src/context-gate/{run,read,session-policy,context-hints,types}.ts`
plus a `context-gate.ts` barrel. BB7 lands only the files this
extraction actually needs; the remaining epic-named files
(`session-policy.ts`, `context-hints.ts`) are created by their own
sub-PRs (BB2 / context-hints wiring) and are out of scope here. The
deferred-extraction LOC audit (epic §2a) counts whatever exists.

```
packages/core/src/
  context-gate/
    types.ts          # EffectiveSettings, GateResult, FetchChunkResult,
                      #   RunOutputResult re-shapes; no Citty, no console
    read.ts           # resolveEffectiveSettings, runTwoGates, readAndFilter,
                      #   persistChunkSet (the file read+filter+store pipeline)
    locate-chunk-set.ts  # locateChunkSet (moved verbatim)
    fetch-chunk.ts    # fetchChunk: locate → loadChunkSet → find chunk
    run.ts            # runOutputPipeline: the composed file/filter orchestrator
  context-gate.ts     # ≤20-line barrel: re-exports the public surface
```

Notes:

- File names are kebab-case; each file one responsibility, all
  ≤300 LOC (current `shared.ts` is ≈133 LOC, so the split lands
  well inside budget). `CLAUDE.md §8`.
- `run.ts` holds the orchestration (the `resolveEffectiveSettings →
  runTwoGates → readAndFilter → persistChunkSet` composition that
  `file.ts`/`filter.ts` currently inline). The CLI's `file`/`filter`
  adapters differ today only in how they obtain `path` (positional
  vs `--file`); both call the SAME `run.ts` orchestrator after the
  adapter resolves `path`.
- `read.ts` keeps `resolveEffectiveSettings`, `runTwoGates`,
  `readAndFilter`, `persistChunkSet` as named exports — moved
  verbatim from `shared.ts`, only the import paths change (the CLI
  imported them from `./shared.js`; core imports the same upstream
  packages directly).
- `defaultNow` / `defaultNewId` move with `read.ts`; the `now` /
  `newId` injection seams (epic §4a clock-injection rule) are
  preserved so tests can pin them.

### §3b Public barrel (`packages/core/src/context-gate.ts`)

Re-exports ONLY the public surface consumed by the CLI adapters and
(later) the MCP bridge:

```ts
export {
  runOutputPipeline,
  type RunOutputInput,
  type RunOutputResult,
} from "./context-gate/run.js";
export { fetchChunk, type FetchChunkResult } from "./context-gate/fetch-chunk.js";
export { locateChunkSet, type LocatedChunkSet } from "./context-gate/locate-chunk-set.js";
export {
  resolveEffectiveSettings,
  type EffectiveSettings,
  type GateResult,
} from "./context-gate/read.js";
```

`packages/core/src/index.ts` appends `export * from
"./context-gate.js";`. Nothing else in `index.ts` changes.

### §3c Result-shape lock (no Citty, no console in core)

Core MUST return data, not print. The orchestrator returns
discriminated results that carry the SAME information the CLI
currently computes inline, so the CLI adapter can reproduce the
exact existing message text and exit codes:

```ts
// packages/core/src/context-gate/run.ts
export type RunOutputResult =
  | { ok: true; result: FilterOutputResult }            // result may carry chunkSetId
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "path_denied"; detail: string }
  | { ok: false; reason: "path_unsafe"; detail: string }
  | { ok: false; reason: "file_read_failed"; detail: string };

// packages/core/src/context-gate/fetch-chunk.ts
export type FetchChunkResult =
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string };
```

The CLI adapter maps each `reason` to the existing `errors.ts`
helper (`sessionNotFoundMessage`, `pathDeniedMessage`,
`pathUnsafeMessage`, `fileReadFailedMessage`, `chunkSetNotFoundMessage`,
`chunkNotFoundMessage`, `storeCorruptMessage`) so message strings
and exit codes are byte-identical. `intent_required`, store-path
Zod parse, and chunk-id/chunk-set-id syntactic validation stay in
the CLI adapter (they are CLI-boundary input validation, epic §5b /
`CLAUDE.md §8` "validate at boundaries"), NOT in core. This keeps
`intentRequiredMessage`, `invalidChunkSetIdMessage`,
`invalidChunkIdMessage` exactly where the existing tests expect the
"no read / no IO" short-circuit to happen.

---

## §4 Thin-adapter shape (CLI after BB7)

`apps/cli/src/commands/output/file.ts`, `filter.ts`, `chunk.ts`
keep their `runOutputFile` / `runOutputFilter` / `runOutputChunk`
exported function names and `Run*Input` types UNCHANGED (the tests
import these by name — `file.test.ts:5`, `filter.test.ts:5`,
`chunk.test.ts:5`). Their bodies shrink to:

1. Resolve store path (Zod) — unchanged, stays in adapter.
2. Parse `sessionId` / validate `chunkSetId` syntax — unchanged.
3. Enforce `intent_required` / `file_required` — unchanged.
4. `ensureStoreReady(rootDir)` → `registry` — unchanged.
5. Call the core orchestrator:
   `runOutputPipeline({ registry, storeRoot, sessionId, path,
   intent, now, newId })` (file/filter differ only in how `path`
   is sourced before the call).
6. `switch (result.reason)` → existing `errors.ts` helper →
   `stderr` + return exit code; on `ok`, render the existing
   text/JSON line and return 0.

`shared.ts` is DELETED from the CLI (its functions now live in
core); `locate-chunk-set.ts` is DELETED from the CLI (moved to
core). The CLI's `index.ts` and the citty `defineCommand` wrappers
are untouched except for import path changes.

`apps/cli/test/output/locate-chunk-set.test.ts` currently imports
from `../../src/commands/output/locate-chunk-set.js`. Because that
file moves to core, this test is RE-HOMED to
`packages/core/test/context-gate/locate-chunk-set.test.ts`
importing from the core barrel — its assertions are unchanged
(characterization preserved at the new location). The
`no-child-process.test.ts` guard stays in the CLI and keeps
passing (the CLI output sources still spawn nothing; `shared.ts`
removal does not affect it, and the moved core file must likewise
contain no `child_process`/`spawn`/`execFile`).

---

## §5 §3c cycle guardrail (MANDATORY — preserved, not weakened)

The relocated module imports, from inside `@megasaver/core`:

- `@megasaver/policy` — `evaluatePathRead`
- `@megasaver/output-filter` — `filterOutput`, `resolveSafeReadPath`,
  `FilterOutputResult`
- `@megasaver/content-store` — `saveChunkSet`, `loadChunkSet`,
  `ChunkSet`, `Chunk`, `ContentStoreError`
- `@megasaver/shared` — `ProjectId`, `SessionId`, `TokenSaverMode`
- core-internal — `CoreRegistry` (already in core)

NONE of `policy`, `output-filter`, `content-store`, `retrieval`,
`stats`, or `shared` may import `@megasaver/core`. Core also MUST
NOT import `apps/*` or `mcp-bridge`. This matches the existing
import directions in `shared.ts` (which imported all four upstream
packages and was itself only imported by the CLI). The move adds
these four packages to `packages/core/package.json` `dependencies`
(currently core depends only on `@megasaver/shared` + `zod`).

**Guard test.** BB7 adds
`packages/core/test/context-gate/dependency-direction.test.ts`
(epic §3c dep-graph-test pattern): parse
`packages/core/package.json` `dependencies`, assert the four new
deps are the allowed set and that core does NOT list `mcp-bridge`
or any `apps/*`. The reverse direction (upstream packages not
importing core) is already covered by each upstream package's own
`dependency-graph.test.ts` from BB3–BB6.

---

## §6 Acceptance criteria

1. `packages/core/src/context-gate/` contains `run.ts`, `read.ts`,
   `locate-chunk-set.ts`, `fetch-chunk.ts`, `types.ts`, each
   ≤300 LOC, one responsibility, kebab-case, no comments except
   WHY, English only, no `child_process`.
2. `packages/core/src/context-gate.ts` barrel ≤20 LOC re-exporting
   only the public surface; `index.ts` re-exports it.
3. `packages/core/package.json` gains `@megasaver/policy`,
   `@megasaver/output-filter`, `@megasaver/content-store`
   (`workspace:*`); `@megasaver/shared` already present.
4. CLI `file.ts` / `filter.ts` / `chunk.ts` are thin adapters
   calling core; `shared.ts` and `locate-chunk-set.ts` deleted
   from the CLI. Exported `run*` names and `Run*Input` types
   unchanged.
5. ALL existing `apps/cli/test/output/*` tests green with NO
   assertion edits (only `locate-chunk-set.test.ts` re-homed to
   core, assertions intact).
6. New core unit tests under `packages/core/test/context-gate/`
   cover the relocated functions directly (§7 of the plan).
7. `dependency-direction.test.ts` green; §3c direction preserved.
8. `pnpm verify` green (lint + typecheck + test). Changeset added
   (core public API gained the context-gate surface; epic §9 item 9).
9. Post-merge: `wc -l packages/core/src/context-gate/*.ts` recorded
   for the epic §2a deferred-extraction LOC audit (>500 LOC → BB12
   extract to its own package; ≤500 → keep folded).

---

## §7 Risk & review (HIGH per epic)

HIGH because it touches core public surface and relocates the
security-sensitive two-gate read path. Per `CLAUDE.md §12` HIGH:
full superpowers chain + `architect` design + `critic` review,
worktree mandatory (this worktree), evidence-preserving only.
Author ≠ reviewer (`code-reviewer`/`critic` in a separate context).
The byte-identical contract is the primary safety net: the CLI
output test suite is the characterization harness and must remain
green at every step.
