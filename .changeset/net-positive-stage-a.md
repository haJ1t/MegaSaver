---
"@megasaver/stats": minor
"@megasaver/context-gate": minor
"@megasaver/cli": minor
---

Stage A of Net-Positive MegaSaver — two independent mechanisms.

A per-workspace net-effect advisory: `mega doctor` weighs 7-day saved tokens
against the cache_creation spread in the local proxy's usage ledger, persists a
verdict, and `mega session saver resolve` echoes it as `netEffectVerdict`.
Nothing acts on the verdict. The spread is a dispersion statistic that the usage
ledger carries no workspace key to attribute, so it never gates the saver. It
also requires the opt-in `mega proxy` (at least 20 continuation rows in the
window); without that ledger every verdict stays `unknown` and doctor only
reports that it cannot judge, so a default install is unaffected.

The saver becomes first-sight-only: an output already compressed in a session is
passed through untouched, and chunk-set ids derive from content hashes so footers
stay stable across re-runs. This ships as a mechanism change with no demonstrated
cost benefit — the Stage A benchmark gate measured 0.948x geomean (min task
0.68x) against a required >=1.0x, and the replay harness that could resolve an
effect this small has not been run. It does not stop a turn's first compression
from invalidating the prompt cache.
