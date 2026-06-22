---
"@megasaver/cli": minor
"@megasaver/agent-office": minor
"@megasaver/gui": patch
---

Phase 5: `mega office` CLI commands + engine hoist

- `@megasaver/agent-office`: hoisted `OFFICE_PROJECT_ID` + `ensureOfficeProject` from the bridge into the engine so CLI and bridge share one canonical office project id.
- `@megasaver/cli`: new `mega office` command group — role/agent CRUD, assign, run (supervisor drain + fake-launcher injection), status, logs, pause/resume/stop. Safe-by-default: `full` roles blocked without `--allow-full`/`MEGA_OFFICE_ALLOW_FULL=1`.
- `@megasaver/gui`: bridge `apps/gui/bridge/routes/office.ts` now imports and re-exports `OFFICE_PROJECT_ID` + `ensureOfficeProject` from `@megasaver/agent-office` (1-line swap, no behaviour change).
