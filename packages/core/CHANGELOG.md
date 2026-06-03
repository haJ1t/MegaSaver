# @megasaver/core

## 1.0.1

### Patch Changes

- a2526d3: Extract the context-gate orchestrator out of `@megasaver/core` into a
  standalone `@megasaver/context-gate` package (AA1 BB12 — §2a
  deferred-extraction trigger fired: 553 LOC > 500). Behavior-preserving:
  the orchestrator's `context-gate -> core` edge (a type-only `CoreRegistry`
  import in 4 files) is broken by a 3-property structural `OrchestratorRegistry`
  port defined in the new package; core's `CoreRegistry` structurally
  satisfies it, so no call site changes. `@megasaver/core` now re-exports the
  orchestrator from `@megasaver/context-gate`, so `apps/cli` and
  `@megasaver/mcp-bridge` consumers keep importing `runOutputPipeline`,
  `runOutputExecCommand`, `fetchChunk`, and `locateChunkSet` from
  `@megasaver/core` unchanged. No runtime behavior changes.
- Updated dependencies [a2526d3]
  - @megasaver/context-gate@0.1.0

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 084123d: Extract the context-gate output orchestrator into `@megasaver/core`. The
  redact/gate/read/filter/persist pipeline and chunk lookup now live in
  `packages/core/src/context-gate/` behind the `context-gate.ts` barrel,
  exposing `runOutputPipeline`, `fetchChunk`, and `locateChunkSet` plus the
  supporting helpers. The `mega output {file,filter,chunk}` CLI commands
  become thin adapters that call the core orchestrator instead of owning the
  pipeline locally; behavior is preserved. This gives BB8 a single
  package the MCP bridge can import (§2a/§8d). A dependency-direction test
  enforces the §3c cycle guard: core depends only on shared, policy,
  output-filter, and content-store, and never on mcp-bridge or apps.
- 751df6c: Add `mega output exec` — the first user-visible child-process spawn in
  Mega Saver. A new core orchestrator `runOutputExecCommand`
  (`packages/core/src/context-gate/run-command.ts`, re-exported from the
  `context-gate.ts` barrel) spawns a policy-gated child process and runs
  its combined stdout+stderr through the redact -> filter -> store ->
  stats pipeline; the `mega output exec` CLI command is a thin adapter
  that calls it, and BB8's MCP `mega_run_command` will reuse the same
  entry point.

  Security invariants enforced and tested: `policy.evaluateCommand` runs
  BEFORE spawn (deny-before-spawn, with a spawn-never-called assertion on
  every denial branch — `command_not_allowed`, `dangerous_pattern`,
  `recursive_megasaver`); `MEGASAVER_ORIGIN_PID` is set on the spawned
  child env and checked on entry so a descendant re-entering Mega Saver is
  denied `recursive_megasaver`; redaction runs before persistence (the
  raw unredacted output is never stored). The child's exit code is
  mirrored on a clean run; `--timeout`/`--max-bytes` bounds (defaults 300s
  / 20MB) force-terminate but still persist the partial output as exit 1.

  `@megasaver/core` now depends on `@megasaver/stats` for the stats step;
  this is acyclic (stats never imports core) and the dependency-direction
  allow-list is widened accordingly. `@megasaver/cli` gains no direct
  stats dependency — it consumes the orchestrator through
  `@megasaver/core` only.

- 522fad4: Add `initStore(rootDir)` — idempotent helper that creates the JSON
  directory store layout (`projects.json`, `sessions.json`) without
  overwriting existing files. Used by `@megasaver/cli` for first-run
  auto-init.
- 367d325: feat: add session CRUD CLI commands and core endSession method

  `@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
  on both registry implementations and a new `session_already_ended`
  error code. `@megasaver/cli` gains four `mega session` subcommands
  (`create`, `list`, `show`, `end`) plus the supporting CLI error
  helpers.

- a0f0c94: Initial release of `@megasaver/core` with neutral `Project`, `Session`, and `MemoryEntry` schemas plus `createInMemoryCoreRegistry()`.
- 256eb34: Add JSON directory-backed CoreRegistry persistence.
- 04987a8: Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
  for partial mutation of an open session. Empty `--title ""` clears
  to `null`; ended sessions are rejected (`session_already_ended`);
  `mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `sessionUpdatePatchSchema` and a
  new `CoreRegistry.updateSession(id, patch)` method on both the
  in-memory and JSON-directory implementations. `apps/cli`'s
  `commands/session.ts` is split into a `commands/session/`
  directory closing v0.1 backlog item I5.

### Patch Changes

- d0003b5: Two cohesive correctness fixes:

  - M3: stale-lock detection. `withDirLock` writes the holding PID
    into `.projects.lock` and uses `process.kill(pid, 0)` to detect
    dead holders. Crashed-process recovery now happens immediately
    rather than waiting the full 5s acquire timeout.
  - M4: Unicode NFC normalization. `Project.name` and `Session.title`
    Zod schemas now normalize to NFC at parse time. NFD inputs are
    observably equal to their NFC equivalents post-parse. Migration
    is lazy: existing on-disk NFD entries are returned as NFC on
    read; subsequent writes persist NFC.

  Public API output type is unchanged (`string` stays `string`),
  but a literal NFD input no longer round-trips byte-equal — it
  becomes its NFC equivalent. Callers comparing literal byte-strings
  against parser output should normalize their fixtures to NFC.

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
- Updated dependencies [6078dc9]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/stats@1.0.0
