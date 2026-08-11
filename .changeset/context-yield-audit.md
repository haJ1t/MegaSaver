---
"@megasaver/context-pruner": minor
"@megasaver/cli": minor
---

Context yield audit (wave-4 1/3): `mega context yield` reports freeloader table (injected vs observed reuse lower bound) with HONEST lower-bound semantics, no causality claims. Pure scorer `computeYieldAudit` (≤300 LOC, strict Zod, 3 signals: read-index/decision-trace/diff fingerprint), CLI thin wrapper, bounded 50-row table + honestNote. TDD 8+4+5 tests, pnpm verify green.
