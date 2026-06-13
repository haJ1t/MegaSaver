---
title: Phase 4 — MCP Server (full roadmap surface) — design
risk: MEDIUM
status: draft
created: 2026-06-11
updated: 2026-06-11
related:
  - docs/superpowers/specs/2026-05-13-bb8-mcp-bridge-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md
  - wiki/syntheses/contextops-roadmap.md
  - MegaSaver_Roadmap.txt
---

# Phase 4 — MCP Server (full roadmap surface) — design

## §0 TL;DR

The MCP server **infrastructure already exists** (`@megasaver/mcp-bridge`:
stdio server, 11 tools, `mega mcp install/serve/status/repair/uninstall`,
agent install helpers). Phase 4's stated exit criterion — an agent can ask
for relevant project memory + code context — is already met by the shipped
`get_relevant_memories` + `get_relevant_context` tools.

This phase closes the **remaining roadmap tool surface**: the four "first
MCP tools" not yet present. Net-new = **4 MCP tools** (`get_project_context`,
`record_failed_attempt`, `save_project_rule`, `get_project_rules`) backed by
**2 new first-class core entities** (`ProjectRule`, `FailedAttempt`) with
their own schemas, branded ids, and registry CRUD. Tool count 11 → 15.

## §1 Motivation

Roadmap Phase 4 ("MCP SERVER") lists eight "first MCP tools". Five exist
today (`search_memory`, `save_memory`, `get_relevant_memories`,
`get_relevant_code_blocks` ≈ `get_relevant_context` family); three do not
(`get_project_context`, `save_project_rule`/`get_project_rules`,
`record_failed_attempt`). The user selected **full roadmap Phase 4**, so all
remaining tools land now, with their backing storage built as first-class
entities rather than freeform memory rows.

`ProjectRule` and `FailedAttempt` are also Phase 5 (FORGE) primitives. The
`memoryTypeSchema` enum already reserves `"project_rule"` and
`"failed_attempt"` slots, so a memory-typed shortcut was possible. We reject
it: Phase 5 (`mega rules apply --task`, failure-similarity search,
convert-failure-to-rule) hard-depends on the structured fields (`appliesTo`,
`severity`, `failedStep`, `errorOutput`, `convertedToRule`). Storing those as
freeform memory text forces Phase 5 to re-parse. First-class entities give
Phase 5 a clean, typed substrate with zero re-parsing.

## §2 Non-goals

- **No Phase 5 learning logic.** No failure-similarity search, no
  convert-failure-to-rule, no `rules apply --task` ranking. Phase 4 only
  records and lists.
- **No new CLI commands.** Roadmap Phase 4 CLI = `mega mcp install/serve/
  status` (shipped). `mega rules` / `mega fail` are Phase 5.
- **No update/delete for the new entities.** Phase 4 needs create + get +
  list only. `convertedToRule` is created `false` and flipped in Phase 5.
- **No embeddings / no agent invocation.** Consistent with Phases 1–3:
  BM25 + keyword/path overlap where ranking is needed; tools select and
  return, they do not call an LLM.
- **No `mega mcp start`/`doctor` aliases.** `serve`/`status` already cover
  the roadmap intent; renaming is cosmetic and out of scope.

## §3 New core entity — ProjectRule (`packages/core/src/project-rule.ts`)

Mirrors `memory-entry.ts` conventions: zod `.strict()`, declaration-order
enums (AA3: declaration order is a contract), ISO datetime with offset,
branded id from `@megasaver/shared`.

```ts
export const ruleSeveritySchema = z.enum(["info", "warning", "critical"]); // ascending
export const ruleConfidenceSchema = memoryConfidenceSchema; // reuse low|medium|high
export const ruleCreatedFromSchema = z.enum(["manual", "failed_attempt", "test_failure"]);

export const projectRuleSchema = z.object({
  id: projectRuleIdSchema,
  projectId: projectIdSchema,
  title: titleSchema,
  rule: z.string().trim().min(1),
  appliesTo: z.array(z.string()).default([]),   // file paths / globs
  evidence: z.array(z.string()).default([]),
  severity: ruleSeveritySchema,
  confidence: ruleConfidenceSchema,
  createdFrom: ruleCreatedFromSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
```

## §4 New core entity — FailedAttempt (`packages/core/src/failed-attempt.ts`)

```ts
export const failedAttemptSchema = z.object({
  id: failedAttemptIdSchema,
  projectId: projectIdSchema,
  sessionId: sessionIdSchema.nullable(),
  task: z.string().trim().min(1),
  failedStep: z.string().trim().min(1),
  errorOutput: z.string().trim().min(1).optional(),
  relatedFiles: z.array(z.string()).default([]),
  suspectedCause: z.string().trim().min(1).optional(),
  resolution: z.string().trim().min(1).optional(),
  convertedToRule: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
```

`sessionId` follows the memory-entry rule: nullable, and when non-null the
registry validates the session exists and belongs to the project.

## §5 Shared ids (`packages/shared/src/ids.ts`)

```ts
export const projectRuleIdSchema = lowercaseUuid.brand<"ProjectRuleId">();
export const failedAttemptIdSchema = lowercaseUuid.brand<"FailedAttemptId">();
```

## §6 Registry (`CoreRegistry` + in-memory + json-directory)

Add to the `CoreRegistry` interface, both implementations
(`createInMemoryCoreRegistry`, `JsonDirectoryCoreRegistry`), and the
json-directory store. All create paths use the existing `requireProject`
guard and the dir-lock TOCTOU mutex; reads parse through the schema.

```ts
createProjectRule(rule: ProjectRule): ProjectRule;
getProjectRule(id: ProjectRuleId): ProjectRule | null;
listProjectRules(projectId: ProjectId): ProjectRule[];

createFailedAttempt(fa: FailedAttempt): FailedAttempt;
getFailedAttempt(id: FailedAttemptId): FailedAttempt | null;
listFailedAttempts(projectId: ProjectId): FailedAttempt[];
```

Storage mirrors per-project memory files: new `project-rules` and
`failed-attempts` directories under the store root, read/written by new
helpers in `json-directory-store.ts`. New `CoreRegistryError` codes:
`project_rule_already_exists`, `project_rule_not_found`,
`failed_attempt_already_exists`, `failed_attempt_not_found`.

## §7 MCP tools (`packages/mcp-bridge/src/tools/`)

| Tool | New file | Backing |
|------|----------|---------|
| `record_failed_attempt` | `failed-attempts.ts` | `createFailedAttempt` |
| `save_project_rule` | `project-rules.ts` | `createProjectRule` |
| `get_project_rules` | `project-rules.ts` | `listProjectRules` (+ optional `task`/`files` filter on `appliesTo`/keywords) |
| `get_project_context` | `project-context.ts` | aggregator (no new storage) |

Each handler mirrors `save-memory.ts`: a zod input schema, `projectId`
resolution, registry call, structured JSON result. The server owns the
clock/id (`now`/`newId` injected via `ServerDeps`), matching existing tools.

`get_project_context` is a **read aggregator** returning a project briefing
an agent pulls at task start:
- project meta (`id`, `name`, `rootPath`) via `getProject`
- project rules via `listProjectRules` (sorted severity desc)
- key memories: high-confidence, non-stale `decision`/`architecture`/
  `project_rule` entries via `listMemoryEntries` + filter
- index summary: block + file counts by type via `@megasaver/indexer`
  (already an mcp-bridge dependency); omitted gracefully if no index exists
- open failed attempts: `convertedToRule === false`, as warnings

Wiring: extend `tool-name.ts` enum (keep alphabetic order → 15 entries),
add `TOOL_DEFS` rows and handler dispatch in `server.ts`.

## §8 Reconciliation

- Tool enum stays a closed, alphabetic set (AA1 §8a/§17). New names slot in:
  `get_project_context`, `get_project_rules`, `record_failed_attempt`,
  `save_project_rule`.
- `memoryTypeSchema` keeps its `project_rule`/`failed_attempt` slots
  untouched — they remain valid memory *categories*; the new entities are a
  separate, structured store. No migration, no conflict.
- No new cross-package dependency: mcp-bridge already depends on `core`,
  `indexer`, `context-pruner`. The cycle guard allow-list is unchanged.

## §9 Risk

MEDIUM. Additive only — no existing tool, schema, or store file changes
shape. Main risks: (1) json-directory store wiring for two new entity dirs
must match the memory pattern exactly (lock, parse-on-read, per-project
files); (2) `get_project_context` aggregation touching the indexer must
degrade cleanly when no index is present. Both are covered by tests in §10.

## §10 Testing (TDD — tests written first)

- **core schema**: valid/invalid cases for `projectRuleSchema`,
  `failedAttemptSchema` (required fields, enum bounds, `.strict()` rejects
  unknown keys, sessionId nullability).
- **core registry**: create/get/list for both entities, in-memory AND
  json-directory round-trip; `requireProject` guard; duplicate-id and
  not-found error codes; failed-attempt session validation.
- **mcp-bridge handlers**: one test file per tool, mirroring existing
  `tools/*.test.ts` (happy path + bad input + not-found project).
- **server e2e**: `ListTools` returns 15; each new tool callable end-to-end
  through the bridge.
- **get_project_context**: aggregation over a seeded project (memories +
  rules + failed attempts + a built index) asserts each section; plus a
  no-index project asserts graceful index-summary omission.

## §11 Decisions / open questions

- **Decided:** first-class entities over memory-typed or hybrid dual-write
  (§1). YAGNI on the auto-mirror until Phase 5/8 needs it.
- **Decided:** no update/delete this phase; `convertedToRule` flip is Phase 5.
- **Decided:** no CLI surface this phase; MCP tools only.
- **Open (low):** `get_project_rules` filter semantics — start with simple
  substring/path-prefix match on `appliesTo` + title/rule text; a scored
  rank lands with Phase 5 `rules apply --task`.

## §12 Out of scope

Phase 5 learning logic, CLI `mega rules`/`mega fail`, entity update/delete,
`mega mcp start`/`doctor` aliases, embeddings, multi-agent connector changes,
dashboard/audit surfacing of rules and failures.
