---
title: Source — MegaSaver Roadmap (Phases 0–10, v2)
tags: [source, roadmap]
sources: []
status: active
created: 2026-06-11
updated: 2026-06-11
---

# Source — MegaSaver Roadmap (Phases 0–10, v2)

Raw file: `~/Desktop/MegaSaver_Roadmap.txt` (2026-06-11). Not copied
into `wiki/raw/` (that folder is user-only / immutable per
[[CLAUDE]] schema). This page is the agent-side summary; the synthesis
lives at [[syntheses/contextops-roadmap]].

## 5-line summary

A strategic restatement of Mega Saver as a "self-improving context
layer for AI coding agents." Defines an 11-phase arc (Phase 0
Foundation → Phase 10 Team/Cloud) plus a parallel version track
(v0.1 → v1.0). Borrows three named patterns: DIMMEM (structured
memory), LAMR (context pruning), FORGE (failed-run learning). Ends
with an MVP package (Phases 1+2+3+4+8) and a "fix the login bug" demo
showing ~72% token savings.

## Key claims

- Category target: **AI Coding Agent Memory & Context Operating Layer**.
- Net priority order: Memory → Repo Index → Context Pruning → MCP →
  FORGE → Task → Tool Router → Audit → Connectors → Team/Cloud.
- Memory must be **atomic, typed, self-contained, multi-dimensionally
  searchable** — 10 `MemoryType`s (decision/bug/architecture/todo/
  user_preference/failed_attempt/code_pattern/project_rule/dependency/
  test_behavior).
- Context pruning scores blocks on semantic + dependency + test-failure
  + recent-edit + memory + user-mention relevance, minus stale/noise
  penalties; returns 6–8 blocks not 40 files, with reasons.
- FORGE turns a `FailedAttempt` into a reusable `ProjectRule` and warns
  before the agent repeats the mistake.
- Tool Router exposes only the task-relevant tool subset (tokens +
  safety), blocking dangerous tools.
- MVP demo metric target: 53.2k → 14.7k context tokens (~72% saved).

## Reconciliation note

Roughly half the arc is already shipped under different naming (Context
Gate = Phase 3 primitive, mcp-bridge = Phase 4 infra, retrieval =
Phase 2 primitive, stats = Phase 8 primitive, connectors = Phase 9).
The reconciled done/partial/gap map is in
[[syntheses/contextops-roadmap]].

## Related

- [[concepts/structured-memory-engine]] (DIMMEM)
- [[concepts/semantic-repo-index]]
- [[concepts/context-pruning-engine]] (LAMR)
- [[syntheses/post-v1.1-roadmap]] (v1.1 cleanup backlog)
