---
title: WS2 — Cross-file Call Resolution via Import Bindings — design
risk: HIGH
status: draft
created: 2026-06-30
updated: 2026-06-30
related:
  - docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md
  - wiki/entities/indexer.md
  - wiki/entities/context-pruner.md
---

# WS2 — Cross-file Call Resolution via Import Bindings — design

## §0 TL;DR

Today `calledBy` is NAME-based: `build.ts` maps a callee NAME → caller
names. When two files export the same name (two `parse` functions),
`mega_impact`'s reverse closure and the dependency closure include false
callers. WS2 resolves each TS/JS call to a fully-qualified name (FQN)
using the calling FILE's import bindings — not a `ts.Program`
type-checker — so same-named functions in different files get distinct
FQNs and false cross-file edges disappear. Additive, with name-based
fallback preserved for py/go/rust and back-compat.

## §1 Risk

HIGH — changes call-graph semantics (`mega_impact` blast radius,
dependency closure). Mitigation: additive only. New optional
`resolvedCalls` / `resolvedCalledBy` fields; consumers PREFER resolved,
fall back to existing name-based edges. Nothing name-based is removed.

## §2 Light approach (no type-checker)

Per FILE, capture an import-binding map: imported local name → module
specifier.

- `import { a, b as c } from "./m"` → `a → "./m"`, `c → "./m"`
- `import d from "./m"` → `d → "./m"`
- `import * as ns from "./m"` → `ns → "./m"`

Build resolves each block's `call` name:

- name is an imported binding → FQN = `<resolvedModule>#<name>`, where a
  RELATIVE specifier (`./m`, `../x`) resolves to a repo-relative file
  path (try `.ts/.tsx/.mts/.cts/.js/.jsx`, then `/index.*`), and a BARE
  specifier (npm pkg) is kept as-is → `pkg#name`.
- else (local/unknown) → fall back to bare name → FQN `#<name>`.

A defined block's own FQN = `<filePath>#<name>`. `resolvedCalledBy[B]` =
the FQNs of blocks whose resolved call FQN equals B's FQN. Two
same-named functions in different files now have different FQNs → no
false cross-file edges. Locally-defined / unresolved calls produce
`#<name>` FQNs that still match a same-file block (or no block).

## §3 Schema additions (additive, optional)

`CodeBlock` gains `resolvedCalls?: string[]` and
`resolvedCalledBy?: string[]` (FQN arrays). Existing `calls` / `calledBy`
unchanged. The extractor also returns a per-file binding map
(`importBindings`) attached to each block so `build.ts` can resolve
without re-parsing. Old `blocks.jsonl` without these fields still parses.

## §4 Consumers (prefer-resolved, guarded fallback)

- `selectImpact` (reverse `calledBy` BFS): when the current block has
  `resolvedCalledBy`, traverse FQN edges (look up caller block by FQN);
  else fall back to `calledBy` (name). Exhaustive-within-budget contract
  unchanged.
- `selectPack` dependency closure: when a block has `resolvedCalls`,
  resolve each FQN to a block by FQN; else fall back to `calls` (name).

The query symbol (`mega_impact`) stays a bare name; only edge traversal
changes. The root is located by bare name as today, then its outgoing
edges follow resolved FQNs when present.

**Refinement invariant (code review).** Resolved mode must never have
LESS reach than name mode — it removes only *false* same-name edges, not
unresolvable true ones. Two guards enforce this: (1) build records a
caller whose call stays unresolved as `#<name>` under that key, and a
callee's `resolvedCalledBy` unions its precise-FQN callers with the
`#<name>` bucket; (2) consumers resolve each FQN edge by `byFqn`, falling
back PER EDGE to `byName(nameFromFqn)` when it misses. So a
namespace-member call (`ns.run()` → extracted bare `run`, binding is
`ns`) or any unpinnable call still reaches its target by name, while
resolved same-name functions across files stay disambiguated.

## §5 Deferred (full-LSP phase)

Re-exports / barrel files, dynamic `import()`, path-alias resolution
(tsconfig `paths`), and true type-driven resolution (`ts.Program`
checker) are OUT of scope. WS2 is intentionally a light, deterministic,
no-Program pass. Those need the deferred full language-server phase.

## §6 TDD proof

A fixture with two files each exporting `parse` (called by `useA` /
`useB`): after `buildIndex`, `a.ts#parse`.resolvedCalledBy lists only
`useA`'s FQN, `b.ts#parse` only `useB`. The name-based `calledBy` lists
both — the resolved field disambiguates. `selectImpact` on `parse`
(seeded at one file's block) returns only the true caller. Plus
import-binding unit tests (named/aliased/default/namespace; relative →
file path; bare kept) and back-compat (block without resolved fields →
name-based path).
