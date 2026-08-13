---
"@megasaver/cli": minor
"@megasaver/connector-claude-code": minor
"@megasaver/context-gate": minor
"@megasaver/stats": minor
"@megasaver/daemon": minor
---

Exec-Rewrite Saver (wave-2 #1): opt-in PreToolUse mode that rewrites eligible
flat-token Bash commands to `mega output exec-live` before execution, so the
compressed chunk-store-backed output is the only version the client ever
caches. Adds the `^Bash$` exec-rewrite hook entry (tri-state `--exec-rewrite`
install flag), the exec-live delivery path (raw byte-identical on decline,
child exit always mirrored, LD13 self-validation), the PostToolUse saver
exemption for exec-live invocations, and an additive `origin: "exec-rewrite"`
field on overlay saver events (per-origin selector deferred to the UI wave).
