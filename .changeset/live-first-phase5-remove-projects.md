---
"@megasaver/gui": minor
---

Live-first Phase 5: make the GUI app project-free.

The live session cockpit is now the only shell. Deletes from `apps/gui`:

- the legacy project-scoped bridge routes (projects/sessions/memory/
  audit/rules/context/tasks/tools/index/retention and the legacy
  `/api/sessions/:id/token-saver`); handler.ts now 404s those paths.
- the unused Core `registry` from the bridge `RouteContext`,
  `BridgeHandlerOptions`, and `server.ts` wiring (it remains only as
  `createMcpOps`' own dependency).
- the project-scoped views (overview/sessions/memory/rules/index/
  context/tasks/tools) and the components only they used (project
  picker/create form, memory/session forms, legacy token-saver
  panel/modal/stats, savings/badges, retention controls).
- the project/legacy endpoints from the api client (only `fetchHealth`
  and the MCP setup endpoints remain) and the project-scoped view ids.

The live + workspace + session-overlay surface (F0–F4) and `agent-setup`
are unchanged. `@megasaver/core`, the CLI, and `@megasaver/mcp-bridge`
are untouched.
