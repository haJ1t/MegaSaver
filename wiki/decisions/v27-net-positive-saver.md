---
title: v2.7 Direction — Net-Positive Saver
tags: [decision, roadmap, v2.7, saver]
sources: [syntheses/next-wave-2-ideas-2026-08-06.md, syntheses/rtk-competitive-analysis-2026-08-01.md, syntheses/cache-write-cost-reduction-2026-08-01.md, syntheses/saver-cache-churn.md, apps/cli/CHANGELOG.md 2.6.0]
status: complete
created: 2026-08-13
updated: 2026-08-14
---

# Decision: v2.7 = Net-Positive Saver

User directive 2026-08-13 (after v2.6.0): pick the next version's
direction from the unshipped spec bank. Chosen: **Net-Positive Saver**.

## Why this cluster first

The saver's measured numbers are still net-negative: Stage A benchmark
0.948x geomean and cache-churn 0.93–0.97x (`syntheses/saver-cache-churn.md`;
Stage A gate required ≥1.0x). The product tagline is "Less tokens" — the
core promise is unproven while every other wave (trust, mesh) builds on
top of it. The RTK leapfrog list orders leverage-per-effort against the
proven cost decomposition (turn count + cache stability are the levers,
compression ratio is not) and its top code moves are exactly this
cluster (`syntheses/rtk-competitive-analysis-2026-08-01.md` §5).

## v2.7 sequence (locked — all three shipped)

1. **exec-rewrite-saver** (HIGH) — wave-2 build-order #1. PreToolUse
   command rewrite so the compressed chunk-store-backed output is the
   only version the client ever caches; zero churn by construction.
   RTK's mechanism, our losslessness. **Shipped 2026-08-13, PR #348.**
2. **filter-matrix-expansion** (MEDIUM) — top-30 command filters
   (git/docker/kubectl/aws/gh) each behind the reconstruct-or-declare
   gate; cheap breadth close. **Shipped 2026-08-13, PR #349** (10
   filters + additive registry + conformance harness + W4 gate).
3. **mega-discover** (MEDIUM) — honest missed-savings finder: which
   commands bypassed the saver with MEASURED sizes, no counterfactuals.
   **Shipped 2026-08-14, PR #350** (5 bypass causes + windowed
   origin-split mediated context + `--json` + install nudge).

## Deprioritized with reason

- **cache-boundary-guard** (B4) — its own spec records the 2026-07-30
  retraction: PostToolUse rewrites land before first send and history is
  immutable, so on today's client a rewrite cannot hit cached bytes.
  Remaining value (suffix stability) is smaller than the three picks.
- Trust cluster (package-hallucination-firewall, silent-failure-monitor,
  memory-write-15 verify, mcp-security-doctor) — natural wave-8
  candidate, after the saver story is provable.
- Activation cluster (brain-adopt, one-command-up, GUI bridges) —
  conversion-focused; postponed until the Pro saver narrative is true.

## Spec freshness flags (before each implementation starts)

All three specs are `status: draft-design`, dated 2026-08-06, with
`pending: [user-spec-review, architect-pass]`. Since drafting, these
landed on `main` and must be reconciled in each spec before approval:

- Stage A first-sight ledger (v2.3.0) — exec-rewrite spec already
  complements it, but its "no first-sight ledger needed" claim must be
  re-checked against the shipped net-positive code.
- Session Mesh (v2.6.0) — mesh hook infra (warmup/saver/guard) now
  exists; exec-rewrite's PreToolUse path may reuse it.
- `mega discover` must read the shipped usage ledger + hook telemetry
  shapes (`@megasaver/stats` AuditEvent family, Phase 8), not the
  08-06 assumptions.
- Cross-batch contract: "no network I/O in any hook path" still binds.

## Related

- [[syntheses/next-wave-2-ideas-2026-08-06]] — the 20-pair bank this was
  selected from; build order 1, 5, 4 (with #2 deferred).
- [[syntheses/rtk-competitive-analysis-2026-08-01]] — leapfrog rationale.
- [[syntheses/cache-write-cost-reduction-2026-08-01]] — attack lines.
