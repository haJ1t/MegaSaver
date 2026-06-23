---
"@megasaver/agent-office": minor
"@megasaver/shared": minor
"@megasaver/gui": minor
---

Add a live agent transcript (Phase A). The supervisor now projects each claude
stream-json event into a compact `TranscriptEntry` (assistant text, tool calls,
results) and persists it per-agent; the bridge exposes a backlog route and a
live SSE stream; the GUI office board opens a read-only activity feed when you
click an agent. New `officeTranscriptId` branded id in `@megasaver/shared`.
