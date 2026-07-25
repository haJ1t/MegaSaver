---
title: Solo Developer Roadmap — Agent Experience Layer follow-through
tags: [synthesis, product, roadmap, solo, pro]
sources: [syntheses/post-2.0-growth-portfolio.md, syntheses/memory-moat-portfolio.md, apps/cli/CHANGELOG.md 2.2.0, wiki/log.md, user session 2026-07-17, https://arxiv.org/abs/2507.05257, https://arxiv.org/abs/2605.12493, https://arxiv.org/abs/2606.08275]
status: active
created: 2026-07-17
updated: 2026-07-17
---

# Solo Developer Roadmap

## Decision

`v2.1.1` / `@megasaver/cli@2.2.0` completed the Agent Experience Layer:
Brain Sync, Warm Start, Mistake Firewall, Living Brain, Code-Truth Verify, and
Brain Autopilot. The near-term buyer is the individual developer who wants a
better agent every day. Prioritize solo depth plus selective distribution (A+C),
not Team/enterprise expansion. (source: `apps/cli/CHANGELOG.md` 2.2.0; user
target 2026-07-17)

## Sequence and acceptance gates

| Release | Outcome | Bounded slice | Gate |
|---|---|---|---|
| Now / 2.1.1 | Sell the Experience Layer | One named surface and activation path for Sync, Warm Start, Guard, Code-Truth, and Autopilot; measured events only | A new user can enable or understand every prerequisite in one sitting; completion and 7-day return are measured |
| 2.2 | Agent Passport / Hot Handoff | Redacted, bounded task packet: branch/diff state, task summary, unresolved failures, validation-badged memories, target-specific resume instructions; local file/clipboard first | Claude Code → Codex resumes a real task without restating it; no secret/raw transcript crosses the boundary; no target agent auto-launches |
| 2.3 | Brain Doctor | Deterministic health report for stale/contradicted memories, lineage conflicts, pending suggestions, hook/brief coverage, and sync freshness | Every finding is explainable from local evidence and points to an existing repair; activation or 7-day retention improves |
| 2.4 | Context Contracts | Opt-in completed-task fixtures test whether a memory/instruction change still retrieves required evidence within budget; deterministic retrieval assertions first | A failed contract names the missing/stale memory and passes after an auditable repair; traces stay local |
| 2.5 | Déjà Vu | Local, redacted cross-project pattern recall with an honest teaser for the user's own prior fix | Privacy review proves no secret/path leak; teaser-to-Pro conversion and false-positive mute rate meet pre-set targets |

## Evidence discipline

Do not frame Recall Receipts as per-memory dollar causality yet. The product can
truthfully report observed injections and stale/retry work avoided, but not that
one memory caused a successful outcome. Context Contracts is the prerequisite
for a defensible claim; counterfactual replay remains research, not launch
copy. (source: [Causal Agent Replay](https://arxiv.org/abs/2606.08275))

Memory research also treats quality as retrieval, learning, long-range
understanding, and selective forgetting—not storage alone. That supports Doctor
and Contracts as the trust layer after the Experience Layer. (source:
[MemoryAgentBench](https://arxiv.org/abs/2507.05257),
[LongMemEval-V2](https://arxiv.org/abs/2605.12493))

## Risk and handoff

Agent Passport is HIGH risk: it needs redaction-first construction, explicit
destination/expiry, no implicit remote sync, and the HIGH review chain. Brain
Doctor is MEDIUM when read-only; Context Contracts becomes HIGH once it reads
recorded traces. Each selected release still needs its own approved design,
plan, TDD, and independent review. The next design decision is therefore Agent
Passport, unless activation data shows the shipped layer is not reaching users.

