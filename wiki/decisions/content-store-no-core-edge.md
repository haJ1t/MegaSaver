---
title: 'content-store (and the AA1 leaf packages) must not import core'
tags: [decision, content-store, dependency-graph, aa1, locked]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: locked
created: 2026-05-11
updated: 2026-05-11
---

# No `content-store → core` edge (AA1 §3c cycle guardrail)

**Locked (AA1 §3c).** None of the five new AA1 leaf packages —
`policy`, `output-filter`, `content-store`, `retrieval`, `stats` —
may import `@megasaver/core`. Core composes them; they return data.

## The cycle that was avoided

`@megasaver/core` orchestrates sessions, the registry, and (per the
spec) the Context Gate. If `content-store` imported core (e.g. to
reuse `resolveStorePaths` or `atomicWriteFile`), and core imported
`content-store` to persist chunk sets, the package graph would close
a cycle that `pnpm verify` typecheck alone can miss (a `*.js`
re-export chain slips past it).

## How content-store avoids it (the concrete edge)

- The resolved `storeRoot` is **passed in by the caller**;
  `content-store` never calls core's `resolveStorePaths`.
- Atomic write is **re-implemented in-package**
  (`packages/content-store/src/atomic-write.ts`, ≈ 50 LOC mirroring
  `json-directory-store.ts` — POSIX dir-fsync, win32-aware) rather
  than reusing core's. The bounded duplication is the accepted cost
  of keeping the dependency arrow one-directional. A behavioural
  parity test (NOT source-byte-equality, which is brittle) asserts
  both implementations produce identical observable outcomes
  (§10c). The same in-package pattern is used by `@megasaver/stats`.

## Allowed edges (the §3c matrix)

| Package | May depend on | MUST NOT |
|---|---|---|
| `shared` | (none) | everything else |
| `policy` | shared | core, output-filter, … |
| `output-filter` | shared, policy | core (§2e) |
| `content-store` | shared, output-filter (`OutputSourceKind`) | core |
| `retrieval` | shared | policy, core |
| `stats` | shared, output-filter (`OutputSourceKind`) | policy, core |
| `core` | all above | mcp-bridge, apps |

Confirmed against the shipped `package.json` files (BB3–BB7a): every
edge holds. Each new package ships a `dependency-graph.test.ts` that
parses its `package.json` `dependencies` against this allow-list and
fails on any extra edge.

Related companion: the `TokenSaverMode` hoist to `@megasaver/shared`
(§2e) exists for the same reason — it stopped `output-filter` from
having to import core for the mode enum.

## Related

- [[concepts/context-gate-pipeline]] — the dependency-direction note.
- [[concepts/agent-agnostic-core]] — the same leaf-returns-data,
  core-composes discipline.
- [[entities/content-store]], [[entities/stats]] — the in-package
  atomic-write consumers.
