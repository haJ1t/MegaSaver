---
title: Wave-2 Ideas — Banked Inventory + Fresh Ideation → 20-Pair Spec Batch
tags: [synthesis, ideas, backlog, wave-2]
sources:
  - syntheses/rtk-competitive-analysis-2026-08-01.md
  - syntheses/cache-write-cost-reduction-2026-08-01.md
  - syntheses/llm-code-problems-research-2026-07.md
  - syntheses/solo-developer-roadmap.md
  - 3-lens ideation round 2026-08-06 (workflow-gap, trust, onboarding)
status: active
created: 2026-08-06
updated: 2026-08-06
---

# Wave-2 Ideas (2026-08-06)

Second idea wave (user directive: "new ideas beyond the batch-1
eleven, specs+plans for all"). Sources: three banked pre-spec
inventories + a fresh 3-lens ideation round. Result: **20 spec+plan
pairs** (`2026-08-06-*`, build-order "N of 20 (wave-2 batch)").

## Selected — from banked inventories (build 1–12)

1. **exec-rewrite-saver** (HIGH) — RTK's zero-churn PreToolUse
   command-rewrite mechanism + our losslessness (rtk-analysis #2).
2. **cache-boundary-guard** (HIGH) — proxy feeds `cache_control`
   breakpoint positions to the saver; exact churn elimination (B4).
3. **cache-doctor** (MEDIUM) — suffix-stability linter + own-block
   determinism audit (B5+B6 merged).
4. **mega-discover** (MEDIUM) — honest missed-savings finder;
   measured exposure, no counterfactuals (rtk-analysis #4).
5. **filter-matrix-expansion** (MEDIUM) — top-10-then-30 command
   filters behind the W4 reconstruct-or-declare gate (rtk #3).
6. **flow-governor** (MEDIUM) — turn-budget nudge + batch-read
   advisor + loop detector; advisory only (A2+A3+loop half of
   llm-problems #7; token half owned by batch-1 budget breaker).
7. **silent-failure-monitor** (MEDIUM) — 4-class failure taxonomy
   over existing stores (llm-problems #4).
8. **package-hallucination-firewall** (HIGH) — offline-first
   phantom-package warn layer, npm+PyPI v1 (llm-problems #1).
9. **memory-write-verify** (HIGH) — write gate + trust rubric + TTL
   eviction for FORGE/agent writes (llm-problems #3).
10. **brain-doctor** (MEDIUM) — roadmap 2.3; read-only memory health
    report, every finding cites evidence + existing repair.
11. **context-contracts** (HIGH) — roadmap 2.4; deterministic
    retrieval regression tests, no LLM in v1.
12. **mcp-security-doctor** (MEDIUM) — over-privilege/clone/
    description-hygiene audit (llm-problems #10).

## Selected — fresh ideation round (build 13–20)

13. **flake-adjudicator** (HIGH) — REAL/FLAKY/LOAD-SENSITIVE verdicts
    at the exec boundary; bounded re-runs, receipts recoverable.
14. **paste-airlock** (HIGH) — big pastes parked losslessly in the
    chunk store; digest + fetch handle enter context instead.
15. **test-bite-proof** (HIGH) — worktree red-proof that a claimed
    regression test bites (test-only diff RED → full diff GREEN).
16. **agent-blame** (MEDIUM) — provenance ledger: which session,
    which intent, which evidence-in-view wrote this line.
17. **undisclosed-change-audit** (MEDIUM) — set-diff the agent's
    narrative vs observed writes; drive-by-edit detector.
18. **generated-file-fence** (HIGH) — derived fence.yaml compiled to
    every agent's native don't-edit dialect via connectors.
19. **one-command-up** (HIGH) — `mega up/down` plan/apply/verify
    activation transaction with undo manifest (RTK gap §3.1).
20. **brain-adopt** (HIGH) — parse existing CLAUDE.md/.cursor rules
    into suggested memories; flagship differentiator in minute two.

## Backlog — ideated, not yet specced (next wave candidates)

- **workspace-preflight** (MEDIUM) — pre-session world snapshot +
  `mega preflight diff` between sessions.
- **session-residue-sweeper** (HIGH) — agent litter manifest +
  quarantine sweep (never deletes).
- **review-attestation** (MEDIUM) — review receipts: diff hash +
  lineage proof for the author≠reviewer gate (§9.6 dogfood).
- **context-yield-audit** (MEDIUM) — freeloader table for injected
  memories/rules (evidence lower bound, no causality claims).
- **pipeline-audition** (MEDIUM) — `npx megasaver audition` proof-
  before-install loop.
- **failure-forensics / mega why** (MEDIUM) — one-command raw-vs-
  delivered forensic view of the last failure.
- **on-demand-core** (HIGH) — daemonless lazy worker from the
  standalone bundle; big architectural change, revisit after mesh.

Also explicitly deferred from banked lists: D10 cache-keep-alive
(billing-ethics math first), C7 tool-schema diet + C8 reminder
compressor (proxy request-shaping gate), D9 first-party-default
packaging (distribution, not a spec-sized feature), cheap-model
routing (quality-parity proof needed), "prove it" public benchmark
(campaign, gated on audit-fix), Déjà Vu (roadmap-sequenced after
Doctor+Contracts).

## Cross-batch contracts (binding on wave-2 drafts)

Batch-1 owners stay owners: claim-verification-gate owns
`childExitCode` receipts; compaction-guard owns
`listOverlayChunkSets`; budget-circuit-breaker owns token-budget
warnings; mesh presence fields `liveSessionId`/`lastSeenAt`, seven
mesh MCP tools. Wave-2 additions: firewall events reuse
`appendFirewallEvent` (no second ledger); no network I/O in any hook
path; honest-metrics (measured bytes, no counterfactuals) everywhere.
