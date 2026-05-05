---
title: '@megasaver/core — v0.1 JSON directory persistence'
date: 2026-05-05
risk: high
status: approved
related:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - wiki/concepts/agent-agnostic-core.md
  - wiki/concepts/risk-aware-development.md
  - wiki/entities/core.md
  - wiki/entities/cli.md
---

# `@megasaver/core` — v0.1 JSON directory persistence

## 1. Context

`@megasaver/shared`, `@megasaver/core`, and `@megasaver/cli` are live
on `origin/main`. Core currently exposes strict `Project`, `Session`,
and `MemoryEntry` schemas plus a synchronous in-memory
`CoreRegistry`. CLI is scaffold-only because a useful command that
mutates state across invocations needs durable storage first.

This spec adds the first durable Core registry implementation. It
does not add CLI CRUD commands, connector behavior, search, context
packing, compression, or migrations. Those features build on this
storage contract in their own specs.

## 2. Goal

Ship the smallest useful durable store for v0.1 dogfood:

1. Add a JSON directory-backed `CoreRegistry` implementation.
2. Preserve the existing `CoreRegistry` public contract and behavior.
3. Store data in a human-readable, git-diffable layout.
4. Keep Core agent-agnostic: no `CLAUDE.md`, `AGENTS.md`, shell
   startup, CLI command, or connector-specific logic.
5. Make persistence failures explicit through typed errors.

Out of scope: see §11.

## 3. Risk

Risk level: **HIGH**.

Reason: this feature chooses the first durable storage format for
Mega Saver sessions and memory. It touches user files under a store
directory and becomes the dependency that CLI CRUD and connector
specs build on.

Required controls:

- Work happens in `feat/core-persistence` worktree.
- Full superpowers chain is mandatory.
- TDD is mandatory for every behavior.
- `pnpm verify` is required before completion.
- Feature smoke evidence is required with a temp store directory.
- External `code-reviewer` and `critic` passes are required before
  merge.
- Wiki updates are required when the spec, plan, review, and merge
  status land.

## 4. Alternatives considered

| Option | Trade-off | Decision |
|---|---|---|
| JSON directory store | Human-readable, diff-friendly, no new runtime dependency, easy to inspect during dogfood. Weaker for concurrent writers and advanced queries. | Chosen for v0.1. |
| SQLite | Stronger transactions and queries, but locks in a driver, migration story, and binary store before query needs are proven. | Deferred. |
| Single JSON file | Simplest initial implementation, but every memory entry churns one large file and merge conflicts become likely. | Rejected. |

The v0.1 store is intentionally conservative. A later spec may move
to SQLite or add indexes after CLI and connector usage prove the real
query patterns.

## 5. Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Backend | JSON directory store. |
| 2 | Factory | `createJsonDirectoryCoreRegistry({ rootDir })`. |
| 3 | Public registry contract | Keep the existing synchronous `CoreRegistry` interface. |
| 4 | Existing implementation | Keep `createInMemoryCoreRegistry()` unchanged. |
| 5 | Root ownership | Caller supplies `rootDir`; Core does not infer `.megasaver` from cwd. |
| 6 | Read behavior | Missing root or missing store files are treated as an empty store. Reads do not create directories. |
| 7 | Write behavior | First write creates needed directories and files. |
| 8 | Atomicity | Mutations write an affected file through temp-file plus rename; no in-place JSON overwrite. |
| 9 | Memory layout | Project-scoped and session-scoped memory entries live in `memory/<project-id>.jsonl`. |
| 10 | Validation | All loaded entities are validated with the existing strict schemas before being returned or used. |
| 11 | Corruption | Invalid JSON, invalid JSONL, and invalid stored entities throw typed persistence errors. No silent recovery. |
| 12 | Concurrency | Multiple concurrent writers are not supported in v0.1. No lock file in this spec. |
| 13 | Migrations | No store version or migration system in this spec. Pre-1.0 layout changes require their own spec. |
| 14 | Deletes/updates | No delete or update behavior. The registry remains create/get/list only. |

These decisions require a follow-up spec to change.

## 6. Store layout

The caller passes the root directory. CLI will later decide where that
root lives for a project; Core only writes under the provided path.

Example root:

```text
.megasaver/
  projects.json
  sessions.json
  memory/
    <project-id>.jsonl
```

`projects.json` stores a JSON array of `Project` objects:

```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Mega Saver",
    "rootPath": "/Users/halitozger/Desktop/MegaSaver",
    "createdAt": "2026-05-05T12:00:00.000Z",
    "updatedAt": "2026-05-05T12:00:00.000Z"
  }
]
```

`sessions.json` stores a JSON array of `Session` objects. Each
session still references a project by `projectId`.

Each `memory/<project-id>.jsonl` stores one `MemoryEntry` JSON object
per line. The filename uses the branded UUID project ID, so the file
name is safe without additional slug rules.

```jsonl
{"id":"33333333-3333-4333-8333-333333333333","projectId":"11111111-1111-4111-8111-111111111111","sessionId":null,"scope":"project","content":"Repo uses strict ESM.","createdAt":"2026-05-05T12:30:00.000Z"}
{"id":"77777777-7777-4777-8777-777777777777","projectId":"11111111-1111-4111-8111-111111111111","sessionId":"22222222-2222-4222-8222-222222222222","scope":"session","content":"Persistence spec is HIGH risk.","createdAt":"2026-05-05T12:35:00.000Z"}
```

Format rules:

- Empty files are invalid. Missing files mean empty store.
- JSON array order is insertion order.
- JSONL line order is insertion order.
- Blank JSONL lines are invalid.
- Unknown entity fields are invalid because the existing schemas are
  strict.

## 7. Public surface

The package keeps the existing export shape and adds persistence
symbols through the same root export.

```ts
export type JsonDirectoryCoreRegistryOptions = {
  rootDir: string;
};

export function createJsonDirectoryCoreRegistry(
  options: JsonDirectoryCoreRegistryOptions,
): CoreRegistry;
```

`rootDir` is resolved with `path.resolve`. It must be a non-empty
string after trimming. If the resolved root exists and is not a
directory, or is a symlink, the factory throws
`CorePersistenceError` with `store_root_invalid`. Existing symlink
store subdirectories, including `memory/`, are rejected before writes
rather than followed. The implementation never writes outside that
resolved root.

The existing in-memory API remains:

```ts
export function createInMemoryCoreRegistry(): CoreRegistry;
```

No subpath exports are added. No CLI, connector, or agent-specific
symbols are exported.

## 8. Persistence errors

Registry semantic errors remain `CoreRegistryError`:

- duplicate project/session/memory IDs
- missing parent project
- missing session
- session/project mismatch

Filesystem and on-disk format failures use a new typed error class.

```ts
export const corePersistenceErrorCodeSchema = z.enum([
  "store_root_invalid",
  "store_read_failed",
  "store_write_failed",
  "store_json_invalid",
  "store_entity_invalid",
]);

export type CorePersistenceErrorCode = z.infer<
  typeof corePersistenceErrorCodeSchema
>;

export class CorePersistenceError extends Error {
  readonly code: CorePersistenceErrorCode;
  readonly filePath: string | null;

  constructor(
    code: CorePersistenceErrorCode,
    message: string,
    options?: { filePath?: string; cause?: unknown },
  );
}
```

Error rules:

- Invalid `rootDir` throws `store_root_invalid`.
- `fs` read failures other than a missing root/file throw
  `store_read_failed`.
- `fs` mkdir/write/rename failures throw `store_write_failed`.
- Invalid JSON or invalid JSONL syntax throws `store_json_invalid`.
- Valid JSON with entities that fail the strict schemas throws
  `store_entity_invalid`.
- Caller-provided invalid entities still surface normal Zod errors
  before any write, matching the in-memory registry behavior.

## 9. Registry behavior

The JSON directory registry implements the same `CoreRegistry`
contract as the in-memory registry.

Project operations:

- `createProject(project)` validates, rejects duplicate IDs, writes
  `projects.json`, and returns a parsed copy.
- `getProject(id)` returns a parsed copy or `null`.
- `listProjects()` returns parsed copies in persisted insertion
  order.

Session operations:

- `createSession(session)` validates, rejects duplicate IDs, requires
  an existing project, writes `sessions.json`, and returns a parsed
  copy.
- `getSession(id)` returns a parsed copy or `null`.
- `listSessions(projectId)` requires an existing project and returns
  matching sessions in persisted insertion order.

Memory operations:

- `createMemoryEntry(entry)` validates, rejects duplicate IDs across
  all project memory files, requires an existing project, requires
  session-scoped memory to reference an existing session in the same
  project, writes the affected project JSONL file, and returns a
  parsed copy.
- `getMemoryEntry(id)` searches memory files and returns a parsed
  copy or `null`.
- `listMemoryEntries(projectId)` requires an existing project and
  returns that project's memory entries in persisted insertion order.

All operations read the current on-disk store before answering. The
registry does not treat process memory as the source of truth. This
keeps separate CLI invocations coherent without adding a cache
invalidation system.

Returned objects are parsed copies. Mutating a returned object cannot
mutate future reads.

## 10. Atomic writes

Every mutation writes only the affected file set:

- project mutation rewrites `projects.json`
- session mutation rewrites `sessions.json`
- memory mutation rewrites `memory/<project-id>.jsonl`

The write sequence is:

1. Ensure the parent directory exists.
2. Serialize the next complete file content.
3. Write to a temporary sibling file.
4. Rename the temporary file over the target path.

Temporary filenames are implementation details, but they must live in
the same directory as the target so rename remains atomic on the same
filesystem. The implementation must not leave successful writes
depending on temporary files.

This spec does not require `fsync`, lock files, or concurrent writer
protection. Those are follow-up specs if needed.

## 11. Out of scope

- CLI CRUD commands.
- Default store discovery such as `<projectRoot>/.megasaver`.
- Update/delete/archive operations.
- Store migrations or `storeVersion`.
- SQLite or other database backends.
- File locking or multi-process write coordination.
- Memory search, indexes, embeddings, or ranking.
- Token audit and context packing.
- Compression.
- Connector behavior.
- Agent-specific files or config formats.
- ID or timestamp generation helpers.
- Importing `@megasaver/cli` from Core.

## 12. Package layout

Expected core additions:

```text
packages/core/
├─ src/
│  ├─ errors.ts
│  ├─ json-directory-registry.ts
│  └─ index.ts
└─ test/
   └─ json-directory-registry.test.ts
```

The implementation may add small private helpers inside
`json-directory-registry.ts` as long as the file stays within the
300 LOC convention. If the file would exceed that, split focused
private modules before merging.

Runtime dependencies:

- Existing `@megasaver/shared`.
- Existing `zod`.
- Node built-ins: `node:fs`, `node:path`, and `node:os` if temp
  helpers need it.

No new runtime package dependency is expected.

## 13. Test strategy

The implementation plan must use strict TDD.

Required test groups:

1. Factory options
   - rejects empty `rootDir`
   - rejects an existing non-directory `rootDir`
   - resolves relative `rootDir` consistently
2. Empty store behavior
   - missing root lists no projects
   - missing files are treated as empty
   - read operations do not create directories
3. Project persistence
   - creates the root and `projects.json` on first project write
   - survives a new registry instance
   - preserves insertion order
   - rejects duplicates with `CoreRegistryError`
4. Session persistence
   - requires existing project
   - persists across registry instances
   - lists by project in insertion order
5. Memory persistence
   - writes `memory/<project-id>.jsonl`
   - persists project-scoped and session-scoped memory
   - rejects missing project, missing session, and session/project
     mismatch
   - rejects duplicate memory IDs even when checking across project
     memory files
6. Copy behavior
   - returned project/session/memory objects cannot mutate stored
     data
7. Corruption behavior
   - invalid `projects.json` throws `CorePersistenceError`
   - invalid `sessions.json` throws `CorePersistenceError`
   - invalid memory JSONL throws `CorePersistenceError`
   - schema-invalid stored entities throw `CorePersistenceError`
8. Verification
   - `pnpm --filter @megasaver/core test`
   - `pnpm --filter @megasaver/core typecheck`
   - `pnpm --filter @megasaver/core build`
   - `pnpm verify`

Tests must use temporary directories and must not write under the
repository root except normal build/test output already ignored by
the repo.

## 14. Wiki updates

When this spec lands:

- Update `wiki/entities/core.md` to mention the persistence spec and
  mark status as `persistence-spec`.
- Update `wiki/index.md` status to show Core persistence spec phase.
- Append a `wiki/log.md` entry for the persistence spec.

When the implementation plan lands, append another log entry. When
implementation, review, and merge complete, update the core entity
status and append evidence at each stage.
