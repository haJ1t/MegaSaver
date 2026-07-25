---
"@megasaver/context-gate": patch
"@megasaver/stats": patch
"@megasaver/cli": patch
---

remove the net-effect auto-pause; the verdict is advisory only

The estimator's `Σ max(0, cache_creation − median)` is a dispersion statistic,
not a cost or causation measurement: it is positive for any spread distribution
whether or not the saver caused a token, and the usage ledger carries no
workspace key to attribute it with. Holding total cache_creation constant and
changing only its spread flips the verdict, so ordinary traffic shape (prompt
cache TTL expiry, compaction) could silently switch the saver off.

- `@megasaver/stats`: `NetEffectVerdict.churnTokens` → `excessTokens`.
- `@megasaver/context-gate`: `saverPausedByNetEffect` and `writeResumeOverride`
  removed; `NetEffectRecord.churnTokens` → `excessTokens` and the
  `resumeOverrideAt` field is dropped (existing records read as absent).
- `@megasaver/cli`: the saver hook no longer takes a pause dependency,
  `mega session saver resume` is removed, and `mega doctor` reports a negative
  verdict as an explicitly unattributed warning instead of failing.
