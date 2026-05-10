---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
status: persistence-merged
created: 2026-05-04
updated: 2026-05-08
---

# `@megasaver/core`

Agent-agnostic Core Engine. CLI and connectors build on this neutral package; never the reverse ([[concepts/agent-agnostic-core]]).

## Schemas (Zod, all `.strict()`)

`Project` — `packages/core/src/project.ts:4`:

- `id: ProjectId` (branded UUID)
- `name: string` (`.trim().min(1)`)
- `rootPath: string` (`.trim().min(1)`)
- `createdAt: string` (`.datetime({ offset: true })` — RFC 3339)
- `updatedAt: string` (`.datetime({ offset: true })`)

`Session` — `packages/core/src/session.ts:4`:

- `id: SessionId`
- `projectId: ProjectId`
- `agentId: AgentId`
- `riskLevel: RiskLevel`
- `title: string | null`
- `startedAt: string` (RFC 3339)
- `endedAt: string | null` (RFC 3339)

`MemoryEntry` — `packages/core/src/memory-entry.ts:4`:

- `id: MemoryEntryId`
- `projectId: ProjectId`
- `sessionId: SessionId | null`
- `scope: "project" | "session"`
- `content: string` (`.trim().min(1)`)
- `createdAt: string` (RFC 3339)
- Cross-field rule: `scope === "session"` requires `sessionId !== null`.

## Registry interface (`packages/core/src/registry.ts:7`)

All methods are **synchronous** (return value, not Promise). Registry implementations may do file I/O internally but the surface stays sync. JSON-directory registry serialises create-style mutations (`createProject`, `createSession`, `createMemoryEntry`) via a sync `.projects.lock` file (5s acquire timeout, `Atomics.wait` 50ms backoff, `process.kill(pid, 0)` stale-holder detection — crashed-process recovery in <100 ms via PID-in-lockfile + ESRCH check). `Project.name` and `Session.title` are NFC-normalized at parse time (Zod `.transform(s => s.normalize("NFC"))`) so identity strings have a single canonical byte representation; lazy migration on read for any pre-existing NFD entries on disk.

```ts
interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  updateSession(id: SessionId, patch: SessionUpdatePatch): Session;
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}
```

`updateSession(id, patch)` — partial mutation on an open session.
Throws `session_not_found` (unknown id) or `session_already_ended`
(closed session). Patch validated by `sessionUpdatePatchSchema`
(Zod, strict + ≥1 key required).

CLI must construct **full** entities — registry parses with strict Zod and rejects partials with `CorePersistenceError("store_entity_invalid", ...)`.

## Public surface

- Schemas above + their inferred types, including `sessionUpdatePatchSchema`.
- `createInMemoryCoreRegistry()` — deterministic, no I/O.
- `createJsonDirectoryCoreRegistry({ rootDir }): CoreRegistry` — durable: `projects.json`, `sessions.json`, `memory/<projectId>.jsonl`. Temp-file + rename writes.
- `initStore(rootDir): Promise<void>` — async, idempotent. Creates rootDir + empty `projects.json` + empty `sessions.json` if missing. Used by CLI auto-init.
- `CoreRegistryError extends Error { code: CoreRegistryErrorCode }` — codes: `project_already_exists`, `project_not_found`, `session_already_exists`, `session_already_ended`, `session_not_found`, `session_project_mismatch`, `memory_entry_already_exists`. Source: `packages/core/src/errors.ts:3`.
- `CorePersistenceError extends Error { code: CorePersistenceErrorCode; filePath: string | null }` — codes: `store_root_invalid`, `store_read_failed`, `store_write_failed`, `store_json_invalid`, `store_entity_invalid`. Source: `packages/core/src/errors.ts:23`.

## Boundary rules

- Core may depend on `@megasaver/shared`. Never on `@megasaver/cli` or any connector.
- Core must not know any agent config format (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`).
- Core must not start agents or shell commands.
- Core must not enforce display-layer policies (e.g. unique names) — that lives in CLI/connector.
- Storage implementations stay neutral: no CLI defaults, no agent-specific layout assumptions.

## Implementation status

Foundation + JSON persistence: PR <https://github.com/haJ1t/MegaSaver/pull/4> (`0656114`). `initStore` + cli project CRUD consumer: PR <https://github.com/haJ1t/MegaSaver/pull/5> (`9003968`). M1 lock + M2 failure-mode tests: PR <https://github.com/haJ1t/MegaSaver/pull/9> (`0dc2e29`). M3 stale-lock detection + M4 NFC normalization: PR <https://github.com/haJ1t/MegaSaver/pull/10> (`ac27142`). Session CRUD: `endSession` mutation + `session_already_ended` code: PR <https://github.com/haJ1t/MegaSaver/pull/11> (`9c5a388`). All on `origin/main`. 129 tests across 15 files.

## Risk

Risk HIGH. Full superpowers chain; code-reviewer + critic both required.

## Related

- [[concepts/agent-agnostic-core]] — non-negotiable boundary.
- [[entities/shared]] — branded id types, `RiskLevel`, `AgentId`.
- [[entities/cli]] — first consumer of the persistent registry.
- [[workflows/cli-test-pattern]] — how CLI handlers consume this surface in tests.
