---
title: '@megasaver/retrieval'
tags: [entity, package, retrieval, bm25, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-05-11
---

# `@megasaver/retrieval`

Local-only retrieval for the Context Gate ranker — BM25 over chunked
text plus intent derivation. No embedding API, no remote vector store
(`CLAUDE.md` §1 non-goal). Shipped BB6 (PR #71, `6078dc9`, alongside
`@megasaver/stats`). Risk MEDIUM.

## Public surface (`packages/retrieval/src/index.ts`)

- `rankBm25(input: Bm25RankInput): Bm25Result` (`src/bm25.ts`) —
  in-memory BM25; the index is built per-call (no persistent inverted
  index at v0.5 — chunk counts < 1000, so building each call is fine;
  a session-scoped index is a v0.6+ profiling decision). Inputs
  `Bm25Document` / `Bm25RankInput`.
- `deriveIntent(input: DeriveIntentInput): DerivedIntent` (`src/intent.ts`)
  — `{ query, keywords, source }`. `derivedIntentSourceSchema` /
  `DerivedIntentSource` is a 6-member closed enum alphabetic (AA3):
  `auto`, `command`, `explicit`, `file-path`, `recent-memory`,
  `session-title`. Precedence walk (§12c) stops at the first
  non-empty: explicit → session-title → recent-memory → command →
  file-path → auto.
- `RetrievalError` + `retrievalErrorCodeSchema` (`invalid_input`).

## Boundary rules (§3c cycle guard)

- May depend on: `@megasaver/shared` only.
- MUST NOT depend on: `@megasaver/policy`, `@megasaver/core`.
  Dep-graph test enforces.

## Related

- [[entities/output-filter]] — consumes ranking results downstream.
- [[entities/stats]] — shipped in the same PR (BB6).
- [[concepts/context-gate-pipeline]] — rank stage.
