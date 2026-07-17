---
"@megasaver/cli": patch
---

`mega brain autopilot run` now reads the autopilot policy ONCE and threads that
single snapshot through both the enabled gate and the run, closing a TOCTOU where
a concurrent `autopilot on/off` (or a direct edit of `autopilot.json`) landing in
the `ensureStore` window between the two former reads could make the run act on a
policy the enabled gate never validated (i14 gauntlet finding #6). Behavior is
unchanged in the common (no-race) case; entitlement-first, enabled-before-store,
and dry-run-free ordering are all preserved.
