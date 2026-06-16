---
"@megasaver/cli": patch
---

Fix the PostToolUse Saver hook reading the wrong payload field.

`mega hooks saver` read the tool output from `tool_output`, but Claude
Code delivers a PostToolUse hook's output under `tool_response`. The
field was always absent, so `readOutputShape` returned `null` and every
real tool call passed through uncompressed — Saver Mode recorded zero
savings despite being enabled. The hook now reads `tool_response`, so
eligible Read/Bash/Grep/Glob/LS output is actually compressed and
recorded. The unit fixtures used the same wrong field name, masking the
bug; they now use the real `tool_response` shape.
