---
title: Memory Moat Portfolio — long-term memory differentiation ideas
tags: [synthesis, product, memory, pro, ideas]
sources: [ultracode workflow wf_4d826f4a-e32 2026-07-12 (19 agents: 1 map, 6 lenses, dedup+gap critic, 3-judge panel, 6 sketches), syntheses/pro-differentiation-portfolio.md, syntheses/post-2.0-growth-portfolio.md, syntheses/solo-developer-roadmap.md, wiki/log.md, user session 2026-07-17, https://arxiv.org/abs/2507.05257]
status: active — v2.1.1 / CLI 2.2.0 completed the Experience Layer; next is cross-agent continuity and proof
created: 2026-07-12
updated: 2026-07-17
---

# Memory Moat Portfolio

User goal (2026-07-11): world-class paid product; killer differentiation;
long-term memory system leveled up. 42 raw ideas → 24 canonical + 8 gap
ideas → 32 judged (buyer / strategist / builder personas, 4 dims × 1-10,
max 40). Complements [[syntheses/post-2.0-growth-portfolio]] (some overlap:
i10≈N10 handoff, i14≈autopilot).

## Baseline weaknesses — release recalibration

1. **Closed:** bi-temporal fields are now written through Living Brain
   supersession and exposed through history / `--as-of`.
2. Embedding sidecar drifts silently (manual index-build only).
3. **Mostly closed:** Autopilot + `mega brain digest` makes the suggested queue
   triageable in the CLI; a GUI approval inbox remains a later convenience gap.
4. **Closed:** main-path dedupe, lineage, and `lastActiveAt` handling now ship.
5. Per-project JSON + in-memory BM25 scaling ceiling; constants not tunable.

## Top 9 (score /40, judges' avg)

| # | Score | Idea | One-liner |
|---|-------|------|-----------|
| i7 | 30.3 | **Mistake Firewall** | PreToolUse hook intercepts commands/edits matching stored failed_attempts; warns agent mid-mistake with priced replay cost. **SHIPPED** (feat/guard: durable guard corpus + 3-tier pure matcher + fail-open hook + outcome loop + mega guard CLI + check_approach MCP + Pro retry-cost-avoided; verify green, 14 TDD tasks all reviewed). |
| i8 | 29.3 | **Warm Start** | SessionStart hook injects ≤2k-token budgeted brief (decisions, rules, todos, branch-relevant failures, git delta) into every agent; measured savings. **SHIPPED** (feat/warm-start: core assembler + freshness stamp, WarmStartEvent, fail-open hook, mega warmup, Pro cross-agent block, MCP tool; verify green, gauntlet passed). |
| i6 | 29.0 | **Code-Truth Verify** | Git-anchored memories: save-time blob+symbol-hash anchors; verify flags memories contradicted by code, revert heals. **SHIPPED** (feat/code-truth, stacked on feat/living-brain: core `memory-anchor` + `code-truth` modules — `captureCodeAnchor`, pure `verifyAnchors` planner + `runVerify` git runner, batch apply, `closedByCodeTruth` ownership guard; `mega memory verify` free + `--install-hook` Pro; sweep pre-pass; save_memory symbol anchors + Pro pre-recall spot-check with sentinel-guarded disclosure; `verify_memories` MCP tool; stale-recall-avoided ledger + savings line; new `code-truth` ProFeature. verify green, 18 TDD tasks all reviewed, 6 opus-reviewed security surfaces; gauntlet cleared a proven cat-file-timeout mass-false-contradiction BLOCKER pre-merge). |
| i1 | 28.3 | **Living Brain** | Auto-superseding write path (fills M1 gap): save detects conflict, closes old validTo, links supersedesId; `history`/`--as-of` time travel. **SHIPPED** (feat/living-brain: core `supersession` module — detect ladder + cosine overlay + close ladder + lineage + `saveMemoryWithLineage`; approve declared-target exemption; `changedFrom` on 4 recall surfaces + sentinel guard; `lastActiveAt` decay rekey; `mega memory history`/`reopen`/`--as-of`; verify 52/52, 16 TDD tasks all reviewed, 2 opus-reviewed security surfaces). |
| i14 | 28.3 | **Brain Autopilot** | Session-end auto-capture + auto-approve trusted types + morning `mega brain digest` y/n/e triage. Kills approval rot. **SHIPPED** (feat/brain-autopilot: core `autopilot` module — pure `scoreCandidate` rule table + `runAutopilot` engine reusing `extractSessionMemories`; `autopilot-store` fail-closed policy/digest-state; `ExtractedCandidate.occurrences` display-only; shared `dedupeKeywordFor` core export. `mega brain autopilot status/on/off/run` (dry-run free, run Pro, per-session cap) + `mega brain digest` Pro y/n/e/s/u/a/q raw-mode triage with revoke; `runMemoryApprove` widened to admit `suggested`, core flip extracted as `applyApprovalFlip`; new `brain-autopilot` ProFeature. M2 dampener: only cross-session recurrence auto-approves — verified end-to-end (single-session 5× storm → auto-approved 0). verify green, 10 TDD tasks all reviewed; gauntlet cleared a proven null-session-forgery M2 bypass and a torn-write digest-state data-loss BLOCKER pre-merge). |
| i21 | 28.0 | **Déjà Vu** | Global cross-project index; recall surfaces redacted hits from other repos ("you fixed this in repo-a"). Free teaser = upsell. Sketched. |
| i4 | 27.7 | **Recall Receipts** | Per-memory $ ROI attribution: log recall injections, credit load-bearing hits, "your brain saved $23 this month". Anti-churn artifact. |
| i10 | 27.7 | **Hot Handoff** | `mega handoff --to codex` carries live working memory between agents mid-task. ≈ N10 in post-2.0 portfolio. |
| g31 | 27.7 | **Brain Compiler** | `mega docs build` compiles approved memories → living ARCHITECTURE.md/DECISIONS.md/ONBOARDING.md in sentinel blocks; docs as distribution. |

## Notable rest (10-18)

i11 Brain Ingest (import claude-mem/Cursor/CLAUDE.md → system of record,
27.0) · i2 Consolidation Engine (local sleep-time compute, 26.3) · i20
`mega why` interrogatable historian (26.3) · i18 Shared Brief Protocol
(26.0) · i3 Brain Doctor health score (25.7) · g27 write-time memory
firewall + redaction ledger (25.3) · i5 approval inbox GUI (25.0) · i9
Brain Check diff review (25.0) · i19 self-tuning recall (25.0). Full list
+ scores: 32 ideas ranked in workflow output (see log 2026-07-12).

## Strategy read — from components to a product loop

The previous recommended chain is now **shipped** in `@megasaver/cli@2.2.0`:
i8+i7 make memory active, i1+i6 make it truthful, and i14 makes it
self-growing. Market it as the **Agent Experience Layer**, not as five separate
technical features. (source: `apps/cli/CHANGELOG.md` 2.2.0; `git` `653f7599`)

The next priority order for the daily individual developer is:

1. **i10 Hot Handoff / Agent Passport** — a compelling public demo and a real
   daily continuity benefit across Claude Code, Codex, machines, and branches.
   It must reuse validation badges, redaction, and explicit Brain Sync rather
   than invent another memory store.
2. **i3 Brain Doctor** — turn the new autonomous brain into a trusted one:
   explain stale, contradictory, unreviewed, and inactive knowledge with a
   repair action. This directly addresses the remaining retrieval-health gap.
3. **Context Contracts** — an opt-in test harness for whether context still
   retrieves the needed evidence after an instruction/memory change. Research
   now evaluates memory as retrieval, learning, long-range understanding, and
   selective forgetting rather than mere storage; the product should make that
   quality visible. (source: [MemoryAgentBench](https://arxiv.org/abs/2507.05257))
4. **i21 Déjà Vu** — only after Doctor/Contracts establish a conservative trust
   bar; cross-project recall is powerful but a leak or noisy hit would damage
   the core promise.

**Deferred:** i4 Recall Receipts may report observed events but must not assign
per-memory dollar causality until an intervention/contract methodology exists.
This preserves Mega Saver's honest-metrics position. Team, Marketplace, and
enterprise work are secondary until this solo loop shows activation and
retention.

Design sketches (arch, CLI, gating, first slice): [[syntheses/memory-moat-sketches]].
