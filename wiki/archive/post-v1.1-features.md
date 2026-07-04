---
title: Post-v1.1 Features — Spec/Plan Index
tags: [sources, specs, plans, output-filter, context-gate, hooks, archive]
sources: [docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md, docs/superpowers/plans/2026-06-26-semantic-ast-read.md]
status: archived
created: 2026-06-26
updated: 2026-06-26
archived: 2026-07-04
redirect: syntheses/post-v1.1-roadmap.md
---

> **ARCHIVED 2026-07-04 — merged into [[syntheses/post-v1.1-roadmap]].**
> All content below was folded verbatim into the "3-feature spec index"
> subsection of the roadmap synthesis. Nothing was deleted; this page is kept
> for grep and history. Update the roadmap page, not this one.

## What

Index of the six spec/plan docs for the three token-saving features shipped after v1.1.
Build order: #2 intent-aware-hook → #1 diff-on-reread → #3 semantic-ast-read.
Concept pages: [[intent-aware-hook]], [[diff-on-reread]], [[semantic-ast-read]].

## Specs

- **intent-aware-hook** (PR #180, risk MEDIUM, phase 6b) — `UserPromptSubmit` hook captures latest prompt to `session-intent.json`; saver hook threads it as FILL-GAP ranking intent (spec: docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md).
- **diff-on-reread** (PR #181, risk HIGH) — re-reading an unchanged file returns a tiny lossless `unchanged-marker` instead of re-filtering/re-persisting; sha256 + per-session read-index (spec: docs/superpowers/specs/2026-06-25-diff-on-reread-design.md).
- **semantic-ast-read** (PR #182, risk HIGH) — large source files chunked along AST boundaries (functions/classes/headings/JSON keys) so ranking scores coherent declarations; lazy indexer import keeps the hot path off the TS compiler (spec: docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md).

## Plans

- intent-aware-hook step plan (plan: docs/superpowers/plans/2026-06-25-intent-aware-hook.md).
- diff-on-reread step plan (plan: docs/superpowers/plans/2026-06-25-diff-on-reread.md).
- semantic-ast-read step plan (plan: docs/superpowers/plans/2026-06-26-semantic-ast-read.md).

## See also

- [[output-filter]], [[context-gate]], [[content-store]] — packages touched.
- [[context-gate-pipeline]] — where these hook into the read/filter flow.
