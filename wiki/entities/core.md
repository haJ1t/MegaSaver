---
title: '@megasaver/core'
tags: [entity, package, core-engine, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-05-core-persistence-design.md
  - docs/superpowers/specs/2026-05-06-cli-project-crud-design.md
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
status: persistence-merged
created: 2026-05-04
updated: 2026-06-12
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
- `tokenSaver?: TokenSaverSettings` — optional; added BB1 (AA1). Absent
  on pre-AA sessions (`undefined`); `.strict()` rejects unknown keys
  but not missing optional ones, so old `sessions.json` rows parse
  unchanged. Migration is a no-op (no script, no version bump).

`TokenSaverSettings` — `packages/core/src/token-saver.ts` (BB1):

- `enabled: boolean`, `mode: TokenSaverMode`,
  `maxReturnedBytes: number` (int, positive), `storeRawOutput: boolean`,
  `redactSecrets: boolean`, `autoRepair: boolean`,
  `createdAt` / `updatedAt` (RFC 3339).
- `defaultTokenSaverSettings(now: () => string)` — `enabled: false`,
  `mode: "balanced"`, `maxReturnedBytes: 12_000`, the rest `true`.
  `now` is mandatory (no module-level `Date.now()`).
- The `TokenSaverMode` enum itself + `modeToBudget` live in
  `@megasaver/shared`, NOT core (AA1 §2e cycle fix); core's
  `token-saver.ts` imports `tokenSaverModeSchema` from shared. See
  [[entities/shared]].

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
  updateTokenSaver(id: SessionId, settings: TokenSaverSettings): Session;
}
```

`updateSession(id, patch)` — partial mutation on an open session.
Throws `session_not_found` (unknown id) or `session_already_ended`
(closed session). Patch validated by `sessionUpdatePatchSchema`
(Zod, strict + ≥1 key required).

`updateTokenSaver(id, settings)` — added BB1 (AA1). Full-replacement
(not a partial `Pick<>`) — enable/disable/status all write the whole
settings object. On both in-memory and JSON-directory implementations.
Reuses `session_not_found` / `session_already_ended` error codes.

CLI must construct **full** entities — registry parses with strict Zod and rejects partials with `CorePersistenceError("store_entity_invalid", ...)`.

## Public surface

- Schemas above + their inferred types, including `sessionUpdatePatchSchema`,
  `tokenSaverSettingsSchema` / `TokenSaverSettings`, and
  `defaultTokenSaverSettings(now)` (BB1).
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

Foundation + JSON persistence: PR <https://github.com/haJ1t/MegaSaver/pull/4> (`0656114`). `initStore` + cli project CRUD consumer: PR <https://github.com/haJ1t/MegaSaver/pull/5> (`9003968`). M1 lock + M2 failure-mode tests: PR <https://github.com/haJ1t/MegaSaver/pull/9> (`0dc2e29`). M3 stale-lock detection + M4 NFC normalization: PR <https://github.com/haJ1t/MegaSaver/pull/10> (`ac27142`). Session CRUD: `endSession` mutation + `session_already_ended` code: PR <https://github.com/haJ1t/MegaSaver/pull/11> (`9c5a388`). BB1 (AA1): `Session.tokenSaver` field + `token-saver.ts` settings + `updateTokenSaver` registry method: PR <https://github.com/haJ1t/MegaSaver/pull/67> (`acebb6c`); the `TokenSaverMode` enum was hoisted to `@megasaver/shared` (AA1 §2e). All on `origin/main`.

**AA1 boundary note:** AA1 §2a proposed a `packages/core/src/context-gate/`
orchestrator shared by CLI + MCP. As of BB7a (PR #73) that directory did
NOT exist — the pipeline was composed CLI-side in
`apps/cli/src/commands/output/shared.ts`. **Superseded post-BB7b:** PR #75
extracted the orchestrator into `packages/core/src/context-gate/` (it now
exists); see the AA1 subsection below. See [[entities/cli]] and
[[concepts/context-gate-pipeline]].

## Risk

Risk HIGH. Full superpowers chain; code-reviewer + critic both required.

## AA1 / Mega Saver Mode

- `Session.tokenSaver?` schema field + `updateTokenSaver` registry
  method on both registries (source: AA1 §4; BB1, PR #67).
- Context Gate orchestrator folded into core at
  `packages/core/src/context-gate/` (`run.ts`, `run-command.ts`,
  `read.ts`, `fetch-chunk.ts`, …) — the shared `mega output exec` /
  `mega_run_command` engine (source: AA1 §2a, §8d; PR #75).
- Post-BB7b the directory measured 553 LOC (> 500), firing AA1 §2a's
  extraction trigger: a standalone `@megasaver/context-gate` is queued
  as BB12 (deferred to its own PR). See
  [[decisions/context-gate-extraction]].

## Phase 10 — Memory Approval (2026-06-12)

`MemoryEntry` gains `approval: "suggested" | "approved" | "rejected"` (default `"approved"`).
`memoryApprovalSchema` + `MemoryApproval` exported from `packages/core/src/memory-entry.ts`.
`backfillMemoryEntry` adds an **independent** approval-defaulting branch: any row lacking the
field gets `approval: "approved"` (backward compat for all Phase 1–9 rows).

**Gate point 1** — `searchMemoryEntries` gains `includeUnapproved: boolean` (default `false`).
The single chokepoint that transitively gates `search_memory`, `get_relevant_memories`, and
`loadPack` (context pack). Filter: `q.includeUnapproved || entry.approval === "approved"`.

**`buildPrMemoryComment`** — pure, deterministic Markdown builder (`packages/core/src/pr-memory-comment.ts`).
Accepts `readonly MemoryEntry[]` + `PrMemoryCommentOptions`. Escape-safe (`\`, `` ` ``, `|`).
Exported from `packages/core/src/index.ts`.

Registry interface (`CoreRegistry`) is **unchanged** — approve/reject reuse `updateMemoryEntry`.
No `visibility` field (YAGNI). No server/auth/hosting added.

## Related

- [[concepts/agent-agnostic-core]] — non-negotiable boundary.
- [[entities/shared]] — branded id types, `RiskLevel`, `AgentId`.
- [[entities/cli]] — first consumer of the persistent registry.
- [[workflows/cli-test-pattern]] — how CLI handlers consume this surface in tests.

## v1.1 / post-v1.0 (2026-06-03)

**PR #88 — BB12: context-gate extracted OUT of core:**

The `packages/core/src/context-gate/` directory (553 LOC, measured
post-BB7b) was moved to the new `@megasaver/context-gate` package.
Core now **re-exports** the full context-gate surface from
`packages/context-gate/src/index.ts` — all existing callers that
`import … from "@megasaver/core"` continue to work without change.

The `CoreRegistry` interface is unchanged; `context-gate` uses its own
structural `OrchestratorRegistry` duck-type to avoid importing core.

**Implementation status update:** core@1.0.2 (patch bump; no public
surface change beyond the re-export wiring). See
[[entities/context-gate]] for the new package details and
[[decisions/context-gate-extraction]] for the BB12 disposition record.
