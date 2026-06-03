# @megasaver/context-gate

## 0.2.0

### Minor Changes

- bb3d179: Load and enforce project permissions (`.megasaver/permissions.yaml`).

  New public API: `loadProjectPermissions(projectRoot): ProjectPermissions | null`
  — synchronously reads `<projectRoot>/.megasaver/permissions.yaml`, parses it with
  the new `yaml@^2` dependency (safe-by-default `parse`, no custom tags / code-exec),
  and delegates validation to the pure `policy.parseProjectPermissions`. An absent
  file returns `null` (baseline only); every other failure mode (non-ENOENT fs error,
  YAML syntax error, schema violation) becomes a single typed `PolicyLoadError` —
  fail-closed.

  `resolveEffectiveSettings` now loads the permissions once per resolve (via an
  injectable loader, default = the real fn) and returns a discriminated
  `ResolveResult` (`session_not_found` | `policy_load_failed` | `ok`); `EffectiveSettings`
  carries the loaded `ProjectPermissions | null`, threaded into `evaluateCommand`
  and `runTwoGates`. A present-but-malformed file denies the operation in resolve,
  before any spawn or `fs.readFile`. Adds the `yaml@^2` runtime dependency.

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [bb3d179]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0
  - @megasaver/policy@1.1.0
  - @megasaver/content-store@1.0.1
  - @megasaver/stats@1.0.1

## 0.1.0

### Minor Changes

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
