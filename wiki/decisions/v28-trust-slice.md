---
title: v2.8 Direction — Trust Slice
tags: [decision, roadmap, v2.8, trust]
sources:
  - decisions/v27-net-positive-saver.md
  - syntheses/next-wave-2-ideas-2026-08-06.md
  - wiki/log.md (2026-08-15)
status: active
created: 2026-08-15
updated: 2026-08-15
---

# Decision: v2.8 = Trust Slice (C3 → silent-failure-monitor → package-firewall)

User directive 2026-08-15 (after v2.7 closed): pick the next version's
direction from the unshipped spec bank. User selected **Batch-1 kalanlar
+ Trust cluster (wave-8)**; the concrete slice was narrowed to three
features in dependency order.

## v2.8 sequence

1. **claim-verification-gate** (C3, MEDIUM, batch-1 #3) — `childExitCode`
   receipts + `mega verify claims` + opt-in Stop-hook reminder. The
   unlock: silent-failure-monitor consumes its `childExitCode` rows and
   Stop plumbing. Merged PR #355.
2. **silent-failure-monitor** (MEDIUM, wave-2 #7) — `mega alerts
   --failures` (4 detectors, no-signal honesty) + opt-in `failure-scan`
   Stop hook with a trigger disjoint from the gate's. PR #356.
3. **package-hallucination-firewall** (HIGH, wave-2 #8) — warn-only
   PreToolUse package-ref layer, `mega firewall status/refresh/allow`,
   the `composeGuardOutputs` seam. PR #357.

## Locked mid-wave amendments (user-approved)

- **Monitor Decision 8**: compaction-guard surfaces (`listOverlayChunkSets`,
  `CAPSULE_FILENAME`, `workStateCapsuleSchema`) are UNSHIPPED — v1
  hardcodes `chunkSets: []` / `capsule: undefined` BY CONSTRUCTION; the
  chunk-set source leg and capsule annotation are deferred until
  compaction-guard lands (additive re-enable, never re-implemented).
- **Firewall (architect B1 repair)**: the shipped `mega firewall --days 7`
  threw `E_UNKNOWN_COMMAND` (subCommands:{airlock} bug) — the feature
  removes the block, folds airlock into positional dispatch, and pins a
  citty-layer regression test.

## Deprioritized (per v2.7 decision, unchanged)

- Trust cluster remainder: memory-write-verify (HIGH), mcp-security-doctor
  — natural follow-ups after this slice lands.
- cache-boundary-guard (B4), activation cluster (brain-adopt,
  one-command-up), batch-1 remainder (compaction-guard, review-packs,
  budget-circuit-breaker, …).

## Related

- [[syntheses/next-wave-2-ideas-2026-08-06]] — the 20-pair bank.
- [[decisions/v27-net-positive-saver]] — the selection source.
