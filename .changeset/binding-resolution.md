---
"@megasaver/indexer": minor
"@megasaver/context-pruner": minor
---

WS2: precise cross-file call resolution for TS/JS via import bindings.
The indexer now resolves each TS/JS call to a fully-qualified name
(`<module>#<name>`) using the calling file's import bindings (named,
aliased, default, namespace; relative specifiers → repo file path, bare
npm specifiers kept as-is) and writes additive optional `resolvedCalls`
/ `resolvedCalledBy` FQN edges on each `CodeBlock`. Two same-named
functions in different files now get distinct FQNs, so `mega_impact`'s
reverse closure and the context-pruner dependency closure no longer
include false cross-file callers. The existing name-based `calls` /
`calledBy` are unchanged; `selectImpact` and `selectPack` prefer the
resolved edges when present and fall back to name-based otherwise
(py/go/rust and old indexes keep working). Light import-binding pass
only — no `ts.Program` type-checker; re-exports, barrels, dynamic
import and tsconfig path aliases are deferred to the full-LSP phase.
