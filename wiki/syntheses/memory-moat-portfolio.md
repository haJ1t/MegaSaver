---
title: Memory Moat Portfolio — long-term memory differentiation ideas
tags: [synthesis, product, memory, pro, ideas]
sources: [ultracode workflow wf_4d826f4a-e32 2026-07-12 (19 agents: 1 map, 6 lenses, dedup+gap critic, 3-judge panel, 6 sketches), syntheses/pro-differentiation-portfolio.md, syntheses/post-2.0-growth-portfolio.md]
status: active — i8 Warm Start + i7 Mistake Firewall + i1 Living Brain + i6 Code-Truth Verify + i10 Hot Handoff SHIPPED; rest awaiting pick
created: 2026-07-12
updated: 2026-07-12
---

# Memory Moat Portfolio

User goal (2026-07-11): world-class paid product; killer differentiation;
long-term memory system leveled up. 42 raw ideas → 24 canonical + 8 gap
ideas → 32 judged (buyer / strategist / builder personas, 4 dims × 1-10,
max 40). Complements [[syntheses/post-2.0-growth-portfolio]] (some overlap:
i10≈N10 handoff, i14≈autopilot).

## Baseline weaknesses found (map agent)

1. Bi-temporal fields (validFrom/validTo/supersedesId) write-orphaned — no
   auto-supersession; M1 degrades to approval+tier filtering.
2. Embedding sidecar drifts silently (manual index-build only).
3. Approval backlog rot — agent writes default `suggested`, invisible; GUI
   cannot approve.
4. No dedupe in main write path; decay keyed to updatedAt (approve resets age).
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
| i10 | 27.7 | **Hot Handoff** | `mega handoff pack --to codex` carries live working memory between agents mid-task. ≈ N10 in post-2.0 portfolio. **SHIPPED** (worktree-feat-hot-handoff, pending merge: redacted, expiring `.megahandoff` packets — pack/open/inspect/clear; redaction-first + secret-path filter + open-side re-redaction + sentinel/slug guards + fail-closed expiry; suggested-gate memory merge; new `hot-handoff` ProFeature with dry-run/inspect/clear free; advisory HandoffEvent ledger; reuses bundle-frame/warm-start/connectors-shared/policy/entitlement, no new store. verify green, 13 TDD tasks all two-stage reviewed — caught NaN expiry, C-quote path bypass, session leak, commit-subject redaction, Trojan-Source sentinels, CRLF corruption, badge/report forgery, citty routing regression). |
| g31 | 27.7 | **Brain Compiler** | `mega docs build` compiles approved memories → living ARCHITECTURE.md/DECISIONS.md/ONBOARDING.md in sentinel blocks; docs as distribution. |

## Notable rest (10-18)

i11 Brain Ingest (import claude-mem/Cursor/CLAUDE.md → system of record,
27.0) · i2 Consolidation Engine (local sleep-time compute, 26.3) · i20
`mega why` interrogatable historian (26.3) · i18 Shared Brief Protocol
(26.0) · i3 Brain Doctor health score (25.7) · g27 write-time memory
firewall + redaction ledger (25.3) · i5 approval inbox GUI (25.0) · i9
Brain Check diff review (25.0) · i19 self-tuning recall (25.0). Full list
+ scores: 32 ideas ranked in workflow output (see log 2026-07-12).

## Strategy read

Top cluster = one coherent story: **"the brain that proves itself"** —
i7+i8 make memory *active* (agent saved unprompted), i6+i1 make it
*truthful* (git-anchored, versioned), i14 makes it *self-growing*, i4
prices it. All reuse shipped infra (hooks, BM25, recall predicate, savings
pipeline, entitlement). Recommended sequence: **i8 Warm Start (2 wk, S
effort, daily-visible) → i7 Mistake Firewall (killer demo) → i1 Living
Brain (fills M1 debt) → i6 Code-Truth Verify → i14 Autopilot → i4
Receipts.** Each = own spec cycle, risk HIGH (memory schema / connector
core path) per [[concepts/risk-aware-development]].

Design sketches (arch, CLI, gating, first slice): [[syntheses/memory-moat-sketches]].
