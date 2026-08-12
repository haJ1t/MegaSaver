# @megasaver/pro-analytics

## 0.2.2

### Patch Changes

- Updated dependencies [db91dd3]
  - @megasaver/stats@1.6.2

## 0.2.1

### Patch Changes

- @megasaver/stats@1.6.1

## 0.2.0

### Minor Changes

- c3ccc07: Add an opt-in `mega cache --suffix-audit` read-only analysis. The Pro gate
  runs before any usage or settings I/O; free-tier invocations read neither.
  The audit adds a closed `suffixAudit` object to `--json` output only (plain
  `mega cache --json` stays byte-compatible) with a `measured-global`
  composition over exactly the four measured token classes — a zero denominator
  reports `no-usage` with null shares, never a misleading 0% — plus static
  Claude settings risks from a closed code union (duplicate owned hooks,
  foreign custom base URL, missing first-party flag on the owned route,
  settings unreadable/malformed, generated-output byte variance).

  Composition is measured fact, not an avoidable-cost claim: a cache-write
  share is the share of measured tokens, not a savings prediction. No risk
  carries a free-text detail, so URLs, commands, secrets, paths, and settings
  content never appear in the report.

### Patch Changes

- 58057c1: Address the independent code-reviewer and critic passes on the cache-advice
  range. Every fix is behavior- or durability-hardening; the public CLI and
  hook surfaces are unchanged.

  - Durability (review P1): capsule state/suppression deletion, the GC sweep
    lock release, and future-timestamp normalization now fsync the parent
    directory after the unlink/futimes, so a deleted entry or normalized node
    is durable across a crash — matching the fair-GC spec §2.2 promise.
  - Queue liveness (review P1): the off-hook maintainer now compacts the
    append-only v3 work log under the no-wait queue lock, dropping fully
    consumed bytes and rewriting control offsets via a durable
    new-file + fsync + rename + parent-directory fsync. Without compaction the
    1 MiB log cap eventually silenced new enrollments permanently.
  - Output-route gate (critic): the default-store gate compares canonical real
    paths, so a symlinked or relatively-spelled path to the default store is
    correctly treated as the same store instead of suppressing advice.
  - Composition integrity (critic): usage-event token counts are capped far
    below 2\*\*53 at the schema boundary, and `cacheComposition` reports an
    `overrange` status with null shares rather than a corrupted 0%/100% when a
    sum loses float64 integer precision.

  The cache-advice GC spec §2.1 records the accepted single-JSONL work log +
  control-offset design (head/inflight replay is the WAL) in place of the
  originally-specified `transition.json`, and the output-route grammar's
  SAFE_WORD is pinned to its exact implemented ASCII-safe class. No token or
  cost-savings claim is made.

- Updated dependencies [07a4e3d]
- Updated dependencies [5e350e3]
- Updated dependencies [1ecbaef]
- Updated dependencies [89eea64]
- Updated dependencies [2c76b5b]
- Updated dependencies [b00c54f]
- Updated dependencies [65575db]
- Updated dependencies [07a4e3d]
- Updated dependencies [9d46944]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [d1093c3]
- Updated dependencies [6ea5968]
  - @megasaver/stats@1.6.0
  - @megasaver/shared@1.3.1

## 0.1.3

### Patch Changes

- Updated dependencies [eb74c35]
- Updated dependencies [8db0074]
- Updated dependencies [6312ef3]
  - @megasaver/stats@1.5.0

## 0.1.2

### Patch Changes

- Updated dependencies [b91c052]
- Updated dependencies [5695012]
  - @megasaver/stats@1.4.0
  - @megasaver/shared@1.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [14b2c6c]
- Updated dependencies [223fa0a]
  - @megasaver/stats@1.3.0
