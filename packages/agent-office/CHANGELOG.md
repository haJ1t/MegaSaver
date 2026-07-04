# @megasaver/agent-office

## 0.1.1

### Patch Changes

- Updated dependencies [326ed5a]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/connectors-shared@1.2.0
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0

## 0.1.0

### Minor Changes

- 7fcd881: Add the Agent Office engine data layer: Role / OfficeAgent / OfficeTask
  schemas, atomic-json stores, and the predefined-role seed set. Adds
  roleId / officeAgentId / officeTaskId branded ids to @megasaver/shared.
- de4ffb2: Agent Office Phase 2: supervisor engine, permission gating, audit log

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

- edb9f06: Phase 5: `mega office` CLI commands + engine hoist

  - `@megasaver/agent-office`: hoisted `OFFICE_PROJECT_ID` + `ensureOfficeProject` from the bridge into the engine so CLI and bridge share one canonical office project id.
  - `@megasaver/cli`: new `mega office` command group — role/agent CRUD, assign, run (supervisor drain + fake-launcher injection), status, logs, pause/resume/stop. Safe-by-default: `full` roles blocked without `--allow-full`/`MEGA_OFFICE_ALLOW_FULL=1`.
  - `@megasaver/gui`: bridge `apps/gui/bridge/routes/office.ts` now imports and re-exports `OFFICE_PROJECT_ID` + `ensureOfficeProject` from `@megasaver/agent-office` (1-line swap, no behaviour change).

- ca611a8: Seed the office with a 24-role catalog modeled on addyosmani/agent-skills
  (one role per skill, grouped by lifecycle phase), replacing the 13 generic
  roles. Add `ensurePredefinedRoles` (idempotent) and wire it into the bridge
  startup + a `mega office role seed` command, so the roster actually appears in
  the GUI and CLI on first run. All seeded roles are `permissionMode: "plan"`
  (safe-by-default) and carry their skill slug in `skillPacks`.
- fac4421: Talk to an office agent (Phase B). The transcript panel gains a message box:
  sending a message posts to a new `POST /api/office/:wk/agents/:id/chat` endpoint
  that records a `user` turn in the transcript, queues it as a task, and runs the
  agent — resuming its claude session so the conversation has continuity. The
  reply streams back into the same live feed. Adds a `user` transcript role.
- 4be82f8: Add a live agent transcript (Phase A). The supervisor now projects each claude
  stream-json event into a compact `TranscriptEntry` (assistant text, tool calls,
  results) and persists it per-agent; the bridge exposes a backlog route and a
  live SSE stream; the GUI office board opens a read-only activity feed when you
  click an agent. New `officeTranscriptId` branded id in `@megasaver/shared`.

### Patch Changes

- 7fcd881: atomicWriteFile no longer reports a failure when the post-rename
  parent-directory fsync throws. Once the rename commits, the file is
  written; the directory fsync is a durability hint, not a correctness
  gate. Prevents spurious write_failed errors that could trigger
  double-writes in caller retry logic.
- Updated dependencies [7fcd881]
- Updated dependencies [8ff3003]
- Updated dependencies [de4ffb2]
- Updated dependencies [44931b7]
- Updated dependencies [0a3256b]
- Updated dependencies [e2f7867]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [031f6de]
- Updated dependencies [391e659]
- Updated dependencies [31238a3]
- Updated dependencies [4e8c6e8]
- Updated dependencies [abfaf3b]
- Updated dependencies [a2b5643]
- Updated dependencies [4be82f8]
- Updated dependencies [900ce56]
- Updated dependencies [900ce56]
- Updated dependencies [f1fe1d3]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [27960fb]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [484f243]
- Updated dependencies [00bd97e]
- Updated dependencies [1db07df]
- Updated dependencies [39e5eb6]
- Updated dependencies [f46ce66]
- Updated dependencies [4fe5749]
- Updated dependencies [4c184db]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/connectors-shared@1.1.0
  - @megasaver/core@1.1.0
