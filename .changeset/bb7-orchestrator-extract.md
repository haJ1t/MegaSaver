---
"@megasaver/core": minor
"@megasaver/cli": patch
---

Extract the context-gate output orchestrator into `@megasaver/core`. The
redact/gate/read/filter/persist pipeline and chunk lookup now live in
`packages/core/src/context-gate/` behind the `context-gate.ts` barrel,
exposing `runOutputPipeline`, `fetchChunk`, and `locateChunkSet` plus the
supporting helpers. The `mega output {file,filter,chunk}` CLI commands
become thin adapters that call the core orchestrator instead of owning the
pipeline locally; behavior is preserved. This gives BB8 a single
package the MCP bridge can import (§2a/§8d). A dependency-direction test
enforces the §3c cycle guard: core depends only on shared, policy,
output-filter, and content-store, and never on mcp-bridge or apps.
