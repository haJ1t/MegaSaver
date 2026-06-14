---
"@megasaver/gui": minor
---

Expand the GUI from a sessions + memory + agent-setup shell into the full
ContextOps surface (P0 + P1 of the GUI analysis).

**New bridge endpoints** (each with zod boundary schema, error-code mapping, and
tests): `POST /api/projects` (create; validates rootPath exists/dir/readable,
rejects duplicate names); `PATCH`/`DELETE /api/memory/:id` (approve/reject/edit/
delete); typed-memory fields + `query`/`limit`/`offset` on `GET /api/memory`;
and read-only `GET /api/projects/:id/{audit,rules,index,index/search,context,
tasks,tools}`.

**New views + IA**: a left sidebar (Workspace / Tools groups) replacing the
3-link top nav; an **Overview** dashboard landing (audit savings cards with a
counts/MCP fallback for new projects); a header **New project** form; Rules,
Index (status + search), Context preview, Tasks, and Tools-router views; and
memory approve/reject/delete + search controls.

**Contract additions**: three `BRIDGE_ERROR_CODES` — `index_unavailable`,
`memory_entry_not_found`, `rootpath_invalid` — with copy + type-pin updates;
`DELETE` added to the CORS allow-list. New workspace deps: `@megasaver/indexer`,
`@megasaver/context-pruner`.

Long-running mutations (index build, connector sync, audit export) and
command-running tools remain CLI-only by design (they need the job/progress
model and policy gating described in the analysis).
