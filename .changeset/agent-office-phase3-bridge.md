---
"@megasaver/gui": minor
---

Add `/api/office/*` bridge routes: role CRUD, workspace-scoped agent/task CRUD,
fire-and-forget run, pause/resume/stop control, audit log, status snapshot, and
SSE live stream. Adds `office_not_configured` and `office_not_found` to
`BridgeErrorCode`. Production server wires `createClaudeCodeLauncher` +
`createLauncherRegistry` into the bridge automatically; `MEGA_OFFICE_ALLOW_FULL=1`
env opts into full-permission mode.
