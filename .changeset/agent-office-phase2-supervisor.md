---
"@megasaver/agent-office": minor
"@megasaver/connectors-shared": minor
"@megasaver/connector-claude-code": minor
---

Agent Office Phase 2: supervisor engine, permission gating, audit log

- `@megasaver/agent-office`: add `createSupervisor` (processNextTask /
  drainAgent / runWorkspace), `resolveLauncherPermission` (safe-by-default
  full gate), `createLauncherRegistry`, `auditEventSchema` /
  `appendAudit` / `listAudit`. Tighten `workspaceKey` to `workspaceKeySchema`
  on `OfficeAgent` and `OfficeTask`. Add `permission_denied` and
  `launcher_not_registered` error codes.

- `@megasaver/connectors-shared`: `LaunchHandle.cancel(signal?)` now accepts
  an optional `NodeJS.Signals` argument (default `SIGTERM`).

- `@megasaver/connector-claude-code`: forward `cancel(signal?)` to
  `child.kill(signal ?? "SIGTERM")`.
