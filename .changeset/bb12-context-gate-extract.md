---
"@megasaver/context-gate": minor
"@megasaver/core": patch
---

Extract the context-gate orchestrator out of `@megasaver/core` into a
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
