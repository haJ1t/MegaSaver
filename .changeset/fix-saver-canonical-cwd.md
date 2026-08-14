---
"@megasaver/cli": patch
---

fix saver: canonicalize the payload cwd before the settings gate and the
workspace key so a symlinked/dotdot-spelled cwd no longer silently passes
through (settings stored under the resolved real path were missed, and the
ledger key split from exec-live's).
