---
title: '@megasaver/core — v0.1 foundation package'
date: 2026-05-04
risk: high
status: approved
related:
  - docs/superpowers/specs/2026-05-04-shared-package-design.md
  - wiki/concepts/agent-agnostic-core.md
  - wiki/concepts/contextops.md
  - wiki/entities/shared.md
---

# `@megasaver/core` — v0.1 foundation package

## 1. Context

`@megasaver/shared` is live on `main` and exports the cross-cutting
contracts that the v0.1 package roster depends on: `RiskLevel`,
`AgentId`, `ProjectId`, `SessionId`, and `MemoryEntryId`.

`@megasaver/core` is the next package in the headless-first v0.1
slice. It is the neutral engine layer that future packages import:
`@megasaver/cli`, `@megasaver/connectors/claude-code`, and
`@megasaver/connectors/generic-cli`.

This first core spec is intentionally narrow. It establishes the
package, the domain entity schemas, and an in-memory registry that
tests parent/child behavior without committing to any filesystem
storage format.

## 2. Goal

Ship the smallest useful core foundation:

1. Define neutral `Project`, `Session`, and `MemoryEntry` schemas.
2. Provide a deterministic in-memory registry for creating, reading,
   and listing those entities.
3. Enforce the agent-agnostic core boundary before connector work
   begins.
4. Lock the package authoring pattern for future core features:
   schema-first, TDD, ESM-only, focused files.

Out of scope: see §10.

## 3. Risk

Risk level: **HIGH**.

Reason: this package defines the core engine boundary and public
surface that CLI and connectors will build against. It must not absorb
agent-specific behavior or a storage format that constrains later
features.

Required controls:

- Work happens in `feat/core-package` worktree.
- Full superpowers chain is mandatory.
- TDD is mandatory for every behavior.
- `pnpm verify` is required before completion.
- External review is required before merge.
- Wiki updates are required when the spec, plan, and merge status land.

## 4. Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | First core slice | Foundation only: entities + in-memory registry. |
| 2 | Storage | In-memory only. Filesystem persistence is a later `memory-vault` spec. |
| 3 | Entity style | Schema-first via Zod; TypeScript types derive from schemas. |
| 4 | Entity boundaries | Entity schemas are strict; unknown public-surface fields are rejected instead of stripped. |
| 5 | IDs | Use branded UUID ID types from `@megasaver/shared`; core does not invent ID formats. |
| 6 | Agent knowledge | `AgentId` is allowed as neutral data; no agent config, file format, or CLI behavior enters core. |
| 7 | Registry lists | Deterministic insertion order. No sorting policy yet. |
| 8 | Registry output | Return parsed copies so callers cannot mutate stored state by reference. |
| 9 | Missing reads | `get*` returns `null`; writes and child lists throw typed registry errors when parent references are invalid. |

These decisions require a follow-up spec to change.

## 5. Public surface

The package exports one public entry point:

```ts
export * from "./errors.js";
export * from "./memory-entry.js";
export * from "./project.js";
export * from "./registry.js";
export * from "./session.js";
```

No subpath exports. No unstable internal exports.

### 5a. `Project`

```ts
import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1),
    rootPath: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
```

`rootPath` is a neutral string path. Core does not inspect the
filesystem in this slice.

### 5b. `Session`

```ts
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    riskLevel: riskLevelSchema,
    title: z.string().trim().min(1).nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;
```

`agentId` is neutral routing data from `@megasaver/shared`; connector
configuration remains outside core.

### 5c. `MemoryEntry`

```ts
import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const memoryScopeSchema = z.enum(["project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    scope: memoryScopeSchema,
    content: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }

    if (entry.scope === "project" && entry.sessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
```

For this slice, memory is text content plus scope. Metadata, search
indexes, embeddings, file citations, and durable storage land in
later specs.

Validation rule: `scope: "session"` requires a non-null `sessionId`.
`scope: "project"` requires `sessionId: null`.

## 6. Registry API

```ts
export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];

  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];

  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}

export function createInMemoryCoreRegistry(): CoreRegistry;
```

Behavior:

- Every write validates with the corresponding Zod schema.
- Duplicate IDs throw `CoreRegistryError`.
- Creating a session requires an existing project.
- Listing sessions requires an existing project.
- Creating a memory entry requires an existing project.
- A session-scoped memory entry requires an existing session in the
  same project.
- Listing memory entries requires an existing project.
- `get*` methods return `null` when the entity does not exist.
- `list*` methods return arrays in insertion order.
- All returned objects are parsed copies.

The registry does not generate IDs or timestamps. Callers provide
validated values. This keeps the foundation deterministic and avoids
locking an ID/timestamp factory into the core package before CLI
flows exist.

## 7. Typed errors

```ts
export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
]);

export type CoreRegistryErrorCode = z.infer<
  typeof coreRegistryErrorCodeSchema
>;

export class CoreRegistryError extends Error {
  readonly code: CoreRegistryErrorCode;

  constructor(code: CoreRegistryErrorCode, message: string);
}
```

Zod validation errors are not wrapped. They already carry structured
issue data and should remain visible to tests and consumers.

## 8. Package layout

```text
packages/core/
├─ src/
│  ├─ errors.ts
│  ├─ index.ts
│  ├─ memory-entry.ts
│  ├─ project.ts
│  ├─ registry.ts
│  └─ session.ts
├─ test/
│  ├─ memory-entry.test.ts
│  ├─ project.test.ts
│  ├─ registry.test.ts
│  └─ session.test.ts
├─ package.json
├─ tsconfig.json
├─ tsconfig.test.json
├─ tsup.config.ts
└─ vitest.config.ts
```

`packages/core` mirrors the established `packages/shared` structure:
ESM-only, `tsup` build, Vitest tests outside `src`, one barrel export.

## 9. Dependencies

Runtime dependencies:

- `@megasaver/shared` via workspace protocol.
- `zod` for schemas.

Dev dependencies:

- `fast-check` for property-based schema tests when useful.

Forbidden dependencies in this spec:

- Agent SDKs.
- CLI frameworks.
- Filesystem database libraries.
- Tokenizers.
- Compression libraries.
- LLM SDKs.

## 10. Out of scope

- Filesystem persistence or a storage directory layout.
- Memory search.
- Token audit.
- Context packing.
- Tool output compression.
- Risk detection beyond storing `Session.riskLevel`.
- CLI commands.
- Connector configuration.
- Agent prompt/rule file generation.
- MCP bridge behavior.
- ID or timestamp generation helpers.

## 11. Test strategy

The implementation plan must use strict TDD:

1. Scaffold package and smoke-test the build pipeline.
2. Add schema tests before each schema module.
3. Add registry behavior tests before `registry.ts`.
4. Add typed-error tests before `errors.ts` or before registry code
   depends on those errors.
5. Run package-level tests after every task.
6. Run `pnpm verify` before completion.

Expected minimum coverage:

- Project schema accepts valid input and rejects empty names/paths.
- Session schema accepts valid input and rejects invalid risk/agent IDs.
- Memory entry schema enforces content, scope, and session linkage rules.
- Registry rejects duplicate IDs.
- Registry rejects child writes whose parent project/session is missing.
- Registry rejects session memory linked to another project.
- Registry returns copies, not stored object references.
- Registry lists in insertion order.

## 12. Wiki updates

When this spec lands:

- Add `wiki/entities/core.md`.
- Add the core entity link to `wiki/index.md`.
- Append a `wiki/log.md` entry for the core package spec.

When the implementation plan lands, append another log entry. When
the PR merges, update the core entity status and append merge evidence.
