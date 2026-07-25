---
"@megasaver/cli": patch
---

Fix the PostToolUse saver stamping a completion heartbeat for tools it never
processes (Write, Edit, TodoWrite, …). Those payloads return before the
invocation heartbeat, so their completion had no matching invocation — and it
was newer than the last recorded failure, which cleared a genuinely broken
saver from `mega doctor`'s `saver-liveness` FAIL down to
"past hook failure(s), since recovered" while compression stayed dead. A
completion is now recorded only for a run that stamped an invocation.
