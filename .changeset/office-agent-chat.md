---
"@megasaver/agent-office": minor
"@megasaver/gui": minor
---

Talk to an office agent (Phase B). The transcript panel gains a message box:
sending a message posts to a new `POST /api/office/:wk/agents/:id/chat` endpoint
that records a `user` turn in the transcript, queues it as a task, and runs the
agent — resuming its claude session so the conversation has continuity. The
reply streams back into the same live feed. Adds a `user` transcript role.
