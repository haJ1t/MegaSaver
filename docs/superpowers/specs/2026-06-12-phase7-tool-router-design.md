---
title: Phase 7 — Tool Router — design
risk: HIGH
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-06-12-phase6-task-engine-design.md
  - docs/superpowers/specs/2026-06-11-phase4-mcp-server-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - wiki/syntheses/contextops-roadmap.md
---

# Phase 7 — Tool Router — design

## §0 TL;DR

Phase 7 adds a **deterministic tool router** to the Core Engine. A
`ToolDefinition` is a first-class, per-project entity describing one tool
an agent could call — its `category`, its `risk`, and a `keywords`
retrieval surface. Given a task string, `routeToolsForTask(tools, query)`
returns `{ allowedTools, blockedTools, reason }`: a small, relevance-
ranked subset of safe tools the agent should load (fewer tool schemas in
context → fewer tokens) and the list of tools held back, with the
**dangerous ones blocked unconditionally** regardless of how well their
text matches the task (the safety half).

Net-new = 1 entity module (`tool-definition.ts`), 1 pure routing module
(`tool-router.ts` reusing `rankBm25` from `@megasaver/retrieval`), a
branded `ToolDefinitionId`, 4 `CoreRegistry` methods
(`createToolDefinition`, `getToolDefinition`, `listToolDefinitions`,
`routeToolsForTask`) implemented identically on both registry backends, 2
new error codes, 1 MCP tool (`route_tools_for_task`; tool count 22 → 23),
and a CLI surface (`mega tools add/list/route/explain`). **No tool
execution, no enforcement at a real call site, no LLM, no embeddings** —
MegaSaver only *advises* which tools to expose; the agent/host decides
whether to honour the advice. `inputSchema`/`outputSchema` are stored as
opaque `z.unknown()` JSON — descriptive metadata only; the engine never
reads or executes them.

## §1 Motivation & philosophy — advisor, not enforcer

Roadmap Phase 7 ("Tool Forge-style MCP Tool Router") turns a flat,
ever-growing pile of tool schemas into a task-scoped allow/block decision
with a dual win: **fewer tokens** (only task-relevant tool schemas enter
the agent's context) and **safety** (dangerous tools are blocked from a
plain task route) — roadmap v0.7
(source: wiki/syntheses/contextops-roadmap.md:144-151).

**The critical architectural fact, identical in spirit to Phase 6:
MegaSaver has no agent runtime.** There is no LLM, no scheduler, and no
place where a tool is actually invoked inside Core (the no-LLM /
no-embeddings constraint from Phases 1–6 holds). So the Tool Router is a
**deterministic recommender**, not a sandbox or a permission broker:

- The calling agent (Claude Code, Codex, …) **registers** the tools it
  knows about (`mega tools add`) — once per project, mirroring how it
  registers rules and memories.
- Before starting a task the agent **asks** the router which tools to
  expose (`route_tools_for_task` / `mega tools route --task`).
- The router **answers** with `{ allowedTools, blockedTools, reason }`.
  The agent loads the `allowedTools` schemas into its context and is
  advised to withhold the `blockedTools`. **MegaSaver does not intercept
  the agent's actual tool calls** — enforcement at a real call site is the
  host's job, and is explicitly out of scope (§13).

Documenting this prevents a future contributor from mistaking the router
for a security boundary. It is a *recommendation* that reduces context
size and flags danger; a host that ignores the advice and runs a
`blockedTools` member is outside MegaSaver's control. This honours the
agent-agnostic principle (`CLAUDE.md` §1) and the "we never block what the
model needs to decide" stance (§1 "What we are NOT"), while still giving
the host a crisp, deterministic danger signal.

## §2 Non-goals

- **No tool execution / invocation.** The engine never calls a tool,
  spawns a process, or touches the network. It ranks and classifies
  metadata.
- **No enforcement at a call site.** `blockedTools` is advice. MegaSaver
  does not wrap, proxy, or intercept the agent's tool dispatch. (Policy-
  gated *command* execution already exists in `@megasaver/policy` /
  `mega_run_command`; this phase does not change or hook it.)
- **No LLM, no embeddings.** Ranking is `rankBm25` only, exactly as
  `failed-attempt-search.ts` and `project-rule-ranking.ts` use it.
- **No `update`/`delete` of a `ToolDefinition` this phase (YAGNI).** A
  tool's identity and metadata are immutable after `createToolDefinition`.
  Re-registering a changed tool is a follow-up slice; nothing here needs
  mutation, so none is added.
- **No execution of, or schema validation against, `inputSchema` /
  `outputSchema`.** They are opaque descriptive JSON (§3d). The router
  never inspects them.
- **No audit dashboard / saved counters** (Phase 8), **no team/cloud
  approval flow** (Phase 10).

## §3 Entities (`packages/core/src/tool-definition.ts`)

### §3a Shape decision — `ToolDefinition` is a first-class entity

A `ToolDefinition` is stored as a top-level per-project entity (its own
JSONL file), not embedded in any other document. Rationale:

- The roadmap schema treats a tool as a standalone record with its own
  id, and the headline query ("which of *all* my tools apply to this
  task?") is a cross-tool list+rank — exactly the shape `ProjectRule`
  takes, not the embedded shape `TaskStep` takes.
- Tools are registered once and routed many times; an independent record
  keeps registration (`createToolDefinition`) and routing
  (`routeToolsForTask`, a pure read) cleanly separated.

Storage therefore mirrors `ProjectRule` / `FailedAttempt`: per-project
JSONL at `tool-definitions/<projectId>.jsonl` with `readAllToolDefinitions`
/ `readToolDefinitionsForProject` / `writeToolDefinitionsForProject` and
a `toolDefinitionsDir` on `StorePaths`.

### §3b Branded id (`packages/shared/src/ids.ts`)

```ts
export const toolDefinitionIdSchema = lowercaseUuid.brand<"ToolDefinitionId">();
export type ToolDefinitionId = z.infer<typeof toolDefinitionIdSchema>;
```

Same `lowercaseUuid` brand as every other id (filesystem-segment-safe,
case-canonical). The engine mints it on create — the caller never supplies
one.

### §3c Closed enums (declaration order is a contract — AA3)

```ts
// Order: roadmap declaration order (Phase 7). Functional grouping of what a
// tool touches; the last three (database, deploy, dangerous) are the
// blocked-by-category set (see §4b). AA3: declaration order is a contract.
export const toolCategorySchema = z.enum([
  "filesystem",
  "search",
  "git",
  "test",
  "package",
  "database",
  "deploy",
  "browser",
  "dangerous",
]);
export type ToolCategory = z.infer<typeof toolCategorySchema>;

// Order: ascending blast radius (safe < medium < dangerous). AA3.
export const toolRiskSchema = z.enum(["safe", "medium", "dangerous"]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;
```

### §3d `ToolDefinition` schema (mirrors `project-rule.ts` / `memory-entry.ts`)

```ts
// Keywords are a retrieval surface (BM25 over name+description+keywords),
// normalized exactly like memory-entry keywords: lowercased, trimmed,
// de-duplicated, empties dropped, first-appearance order preserved.
const toolKeywordsSchema = z.array(z.string()).transform((raw) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
});

export const toolDefinitionSchema = z
  .object({
    id: toolDefinitionIdSchema,
    projectId: projectIdSchema,
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    // Opaque, descriptive only — the router never reads or executes these.
    // z.unknown() so any JSON-shaped value round-trips through the store
    // without the engine taking a dependency on a tool's I/O contract.
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    keywords: toolKeywordsSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
```

`name` reuses `titleSchema` (the shared control-char-safe normalizer used
by every other named entity). There is no `updatedAt` because there is no
update path this phase (§2); a single `createdAt` matches `FailedAttempt`,
the other create-only-no-update entity.

> **Note on `z.unknown()` + `.strict()`:** an *absent* `inputSchema` key
> still satisfies `z.unknown()` (it is `undefined`), so the create-input
> layer (§3e) defaults both to `null` to keep the stored row explicit and
> JSONL round-trip stable. `.strict()` rejects *unknown keys*, not unknown
> *values* — the two are orthogonal, so opaque values and a strict object
> coexist cleanly.

### §3e Create input schema (engine owns id + timestamp)

The caller supplies tool *metadata* but not the id or timestamp.
Mirroring `failureToRuleInputSchema`, a create-input schema carries only
caller-authored fields; `createToolDefinition` mints the id and stamps
`createdAt`.

```ts
export const toolDefinitionInputSchema = z
  .object({
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    keywords: z.array(z.string()).default([]),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
  })
  .strict();

export type ToolDefinitionInput = z.infer<typeof toolDefinitionInputSchema>;
```

`createToolDefinition` (§5) parses the input, mints `id` via
`clock.newId()`, stamps `createdAt` via `clock.now()`, defaults a missing
`inputSchema`/`outputSchema` to `null`, and parses the result through
`toolDefinitionSchema`. Clock is injected so tests are deterministic
(same pattern as `convertFailureToRule`).

## §4 Pure routing module (`packages/core/src/tool-router.ts`)

Pure functions (no I/O), mirroring `failed-attempt-search.ts` /
`project-rule-ranking.ts`, so they unit-test without a store. This module
holds the entire routing + risk-gating policy; the registry method is a
thin wrapper that loads tools and calls it.

```ts
export type ToolRouteResult = {
  allowedTools: ToolDefinition[];
  blockedTools: ToolDefinition[];
  reason: string;
};

export function routeToolsForTask(
  tools: readonly ToolDefinition[],
  query: string | undefined,
): ToolRouteResult;
```

### §4a The two-stage decision (gate first, then rank)

For each tool, stage 1 (the **security gate**) runs *before* any text
relevance is considered:

1. **Risk gate.** If `isBlockedTool(tool)` (see §4b) → the tool goes to
   `blockedTools` and is **never** eligible for `allowedTools`, no matter
   how well it matches the task. This is unconditional and text-
   independent — it is the "block dangerous tools" exit criterion.
2. **Relevance.** Among the **non-blocked** tools only:
   - If `query` is `undefined` or blank → **all** non-blocked tools go to
     `allowedTools` (no task to filter by; expose the safe toolbox).
   - Else → run `rankBm25` over each non-blocked tool's
     `name + " " + description + " " + keywords.join(" ")` against the
     query; a tool with **score > 0** goes to `allowedTools`. A non-
     blocked tool that **fails to match** (score ≤ 0) is *not* dangerous,
     so it does not belong in `blockedTools`; it is simply **omitted from
     both lists** (it is irrelevant, not forbidden). `allowedTools` is
     ordered by descending score, ties broken by `id.localeCompare`
     (stable), exactly like `rankApplicableRules`.

`blockedTools` is ordered deterministically by `id.localeCompare` (no
score applies to a blocked tool).

### §4b Risk-gating policy — the exact blocked set (security-critical)

`isBlockedTool(tool)` returns `true` iff **either**:

- `tool.risk === "dangerous"`, **or**
- `tool.category ∈ BLOCKED_CATEGORIES` where
  `BLOCKED_CATEGORIES = { "dangerous", "deploy", "database" }`.

```ts
const BLOCKED_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  "dangerous",
  "deploy",
  "database",
]);

export function isBlockedTool(tool: ToolDefinition): boolean {
  return tool.risk === "dangerous" || BLOCKED_CATEGORIES.has(tool.category);
}
```

**Why exactly these three categories (justification, not arbitrary):**

- `dangerous` — the category is the explicit "this is destructive" label;
  blocking it by category is the floor, independent of whatever `risk` the
  author typed. A tool can be mis-risk-labelled; the category is a second,
  redundant guard (defense in depth).
- `deploy` — deployment tools mutate **running/production infrastructure**
  (ship, rollback, scale). A plain task route ("fix the login bug") must
  never silently hand the agent a production-deploy tool just because the
  word "login" matched a deploy script's description. The blast radius is
  outside the repo and often irreversible.
- `database` — database tools touch **persistent stores** (migrate, drop,
  truncate, raw SQL). Same reasoning: a text match is not consent to mutate
  durable data; the failure mode is data loss.

These three are blocked *by category* because the cost of a false-allow is
catastrophic and irreversible, so we refuse to let BM25 relevance be the
deciding factor. The remaining six categories (`filesystem`, `search`,
`git`, `test`, `package`, `browser`) are routed normally and gated **only**
by their own `risk === "dangerous"` — so a `filesystem` tool risk-labelled
`dangerous` (e.g. recursive delete) is still blocked, while an ordinary
`safe`/`medium` `filesystem` tool routes through. This makes the gate
*total*: every tool is classified by a single boolean with no undefined
case.

> **Decision (mandated): which half wins.** The risk gate **always
> precedes** relevance. A dangerous/deploy/database tool cannot enter
> `allowedTools` via any text match. There is no override flag, no
> "force" parameter, and no per-call relaxation in this phase — keeping
> the safety contract unconditional and trivially auditable.

### §4c The `reason` string (human-readable, deterministic)

`reason` summarizes the selection in one line so a human (or the CLI
`route` output) can see what happened without re-deriving it:

- With a task and at least one match:
  `"<A> tool(s) matched 'query'; <B> blocked as dangerous/deploy/database; <C> not relevant"`
- With a task and no match:
  `"no tools matched 'query'; <B> blocked as dangerous/deploy/database; <C> not relevant"`
- With no task:
  `"no task filter — <A> safe tool(s) allowed; <B> blocked as dangerous/deploy/database"`

where `A = allowedTools.length`, `B = blockedTools.length`, and
`C` = non-blocked tools omitted for score ≤ 0 (only meaningful when a task
is given). The string is a pure function of the counts + query, so it is
deterministic and stable for a given input.

## §5 Registry methods (`CoreRegistry` + both impls)

Added to the interface and to `createInMemoryCoreRegistry` +
`createJsonDirectoryCoreRegistry`, behaviourally identical (the Phase 4
invariant).

```ts
createToolDefinition(
  projectId: ProjectId,
  input: ToolDefinitionInput,
  clock: { now: () => string; newId: () => string },
): ToolDefinition;
getToolDefinition(id: ToolDefinitionId): ToolDefinition | null;
listToolDefinitions(projectId: ProjectId): ToolDefinition[];
routeToolsForTask(projectId: ProjectId, query: string | undefined): ToolRouteResult;
```

- **`createToolDefinition`** — `requireProject`; build the full
  `ToolDefinition` (mint id, stamp `createdAt`, default opaque schemas to
  `null`) via a shared `buildToolDefinitionFromInput(projectId, input,
  clock)` helper exported from `registry.ts` so both impls stay identical
  (same pattern as `buildTaskPlanFromInput`); reject a duplicate id
  (`tool_definition_already_exists`); write. The json impl performs the
  read-dup-check-write under one `withDirLock`.
- **`getToolDefinition`** — read + parse, returns `null` when absent
  (mirrors `getProjectRule` / `getFailedAttempt`). No `requireProject` (a
  by-id get is global, like every other `get*`).
- **`listToolDefinitions`** — `requireProject`, project-scoped read +
  parse (mirrors `listProjectRules`).
- **`routeToolsForTask`** — `requireProject`, read the project's tools,
  delegate to the pure `routeToolsForTask(tools, query)` (§4), return the
  result. **Read-only** — it never writes, so it takes no lock in the json
  impl (mirrors `searchFailedAttempts` / `searchMemoryEntries`).

> **Critical (json impl):** `createToolDefinition` does its read-dup-
> check-write INLINE inside one `withDirLock`; it never calls another
> public lock-taking method from inside the lock (the dir lock is not
> re-entrant). `routeToolsForTask`/`getToolDefinition`/`listToolDefinitions`
> are pure reads with no lock.

The pure-function name `routeToolsForTask(tools, query)` and the registry
method name `routeToolsForTask(projectId, query)` are intentionally the
same verb at two layers (tool-router.ts vs registry.ts), disambiguated by
import alias in `registry.ts`/`json-directory-registry.ts` exactly as
`searchFailedAttempts as searchFailures` is aliased today.

## §6 New error codes (`packages/core/src/errors.ts`)

Appended to `coreRegistryErrorCodeSchema` (declaration order = append at
end, after `task_step_dependency_unmet`):

```
tool_definition_already_exists
tool_definition_not_found
```

- `tool_definition_already_exists` — duplicate tool id on create (parity
  with every other create path).
- `tool_definition_not_found` — reserved for an addressing-a-missing-tool
  error. **Note:** `getToolDefinition` returns `null` rather than throwing
  (read convention), so the *throwing* use is the CLI/MCP boundary
  rendering "not found" when a `route`/`explain` references a tool id that
  does not exist; the code exists so that boundary is uniform with the
  rest of the taxonomy. It is mandated by the task brief.

## §7 MCP tool (`packages/mcp-bridge`, 22 → 23)

**One** new tool, `route_tools_for_task`, mirroring the Phase 4/5/6 tool
shape (zod input → resolve → registry call → JSON result; map
`CoreRegistryError` codes to wire codes). It slots alphabetically into
`tool-name.ts`, `TOOL_DEFS`, the dispatch switch, and the `test-d` tuple.

| Tool | Input | Output | Backing |
|------|-------|--------|---------|
| `route_tools_for_task` | `projectId, task?` | `{ allowedTools, blockedTools, reason }` | `routeToolsForTask` |

- Input schema: `{ projectId: string, task?: string }` (`.strict()`); a
  blank/absent `task` triggers the no-filter branch (all safe tools
  allowed).
- Error mapping: `project_not_found` → `resource_not_found` (matching
  every other handler); any other `CoreRegistryError` → `validation_failed`.

### §7a Registration is CLI-only — `save_tool_definition` is NOT an MCP tool

**Decision (mandated choice, recommendation taken):** the only MCP tool is
`route_tools_for_task`. Registering a `ToolDefinition` is **CLI-only**
(`mega tools add`). Justification:

- The roadmap names exactly one MCP tool for this phase
  (`route_tools_for_task`); the `tools index/list/route/explain` verbs are
  a *CLI* surface in the same roadmap line.
- The MCP surface is a **closed, audited enum** (AA1 §8a/§17). Each added
  tool is permanent context cost on every agent and a wider attack surface.
  Routing is the high-frequency, per-task call an agent makes; registering
  tools is a low-frequency setup step a developer does once via the CLI.
  Keeping registration off the wire keeps the MCP surface tight and the
  router's safety contract the only tool-related thing an agent can reach.
- Net MCP count is therefore **22 → 23**, not 22 → 24.

Final enum (23, alphabetic): build_task_plan, convert_failure_to_rule,
explain_context_selection, find_similar_failures, get_applicable_rules,
get_context_budget_report, get_project_context, get_project_rules,
get_relevant_code_blocks, get_relevant_context, get_relevant_memories,
get_task_status, mega_fetch_chunk, mega_read_file, mega_recall,
mega_run_command, record_failed_attempt, record_task_step,
retry_failed_step, **route_tools_for_task**, save_memory,
save_project_rule, search_memory.

(`route_tools_for_task` sorts between `retry_failed_step` and
`save_memory`.)

## §8 CLI (`apps/cli`, citty)

New command group `mega tools` registered in `apps/cli/src/main.ts`
`subCommands`, following the `rules` group structure (one dir per group,
citty `defineCommand`, `run<Name>(input): Promise<0 | 1>`, shared output
helpers, `MEGA_TEST_*` deterministic ids via `readTestEnv`, reusing
`mapErrorToCliMessage` / `projectNotFoundMessage` / `ensureStoreReady` /
`resolveStorePath` / `readStoreEnv`).

`apps/cli/src/commands/tools/` → `add`, `list`, `route`, `explain`
(+ `shared.ts`, `index.ts`):

- **`mega tools add <project> --name "..." --description "..." --category
  <cat> --risk <risk> [--keyword k …]`** Registers a `ToolDefinition`.
  **Closed-enum validation at the boundary (Phase 5/6 lesson):**
  `toolCategorySchema.safeParse(--category)` and
  `toolRiskSchema.safeParse(--risk)` each fail with a clean message
  (`error: invalid category "<x>" (filesystem | search | git | test |
  package | database | deploy | browser | dangerous)` and the analogous
  risk message) and exit 1 — never a raw zod dump. Prints the new tool id
  (or JSON). Deterministic id via `MEGA_TEST_TOOL_DEFINITION_ID`. The CLI
  does not expose `--input-schema`/`--output-schema` (opaque descriptive
  JSON is awkward on a flat CLI and unused by routing); they default to
  `null`. An agent that needs to attach them can do so in a follow-up
  slice — not blocking, and the MCP surface does not register tools at all.
- **`mega tools list <project>`** Prints one line per registered tool
  (`id  risk  category  name`), or JSON. Mirrors `rules list`.
- **`mega tools route <project> --task "..."`** Calls
  `routeToolsForTask`; prints an `allowed` block (one line per tool,
  descending score order), a `blocked` block, and the `reason` line. With
  no `--task`, prints all safe tools as allowed plus the blocked set.
  JSON mode emits `{ allowedTools, blockedTools, reason }` verbatim.
- **`mega tools explain <project>`** Per-tool classification walkthrough
  over `listToolDefinitions`: each tool's `category`, `risk`, and
  whether-and-why it is blocked (`blocked: category deploy` /
  `blocked: risk dangerous` / `routable`), plus the policy reminder
  ("dangerous/deploy/database tools are never routed to a plain task").
  Pure formatting over `listToolDefinitions` + `isBlockedTool`; no new
  registry call. (No `<task>` argument — `explain` describes the *static*
  routing policy per tool; `route --task` shows the *dynamic* per-task
  decision. This split mirrors `task explain` vs `task status`.)

### §8a Mapping the roadmap's `index/list/route/explain` verbs

The roadmap lists `mega tools index/list/route/explain`. Mapping
(mandated decision + justification):

- **`index` → `add`.** "Index a tool" in the roadmap means "register a
  tool definition into the per-project index". The repo's established verb
  for "create one entity from flags" is `add` (`mega rules add`) — there is
  no `index` verb anywhere in the CLI for a single-entity create, while
  `mega index ...` already exists as a **different** top-level command
  (the Phase 2 semantic *repo* index: `mega index build/status/search`).
  Reusing the word `index` as a `tools` subcommand would collide
  conceptually with that command and read as "build the repo index".
  `add` is unambiguous, matches the sibling `rules add`, and keeps the
  enum-validation-at-boundary pattern identical. `list` covers the "show
  what's indexed" half of the roadmap's `index` intent.
- `list`, `route`, `explain` map 1:1 to the same-named verbs.

So the CLI surface is `add | list | route | explain`, with `index`
realized as `add` (+ `list`). Documented here so a future reader does not
expect a literal `mega tools index`.

CLI resolves the active project by name the same way existing commands do
(`registry.listProjects().find(p => p.name === projectName)`). No new
resolution logic.

## §9 Reconciliation

- Tool enum stays a closed alphabetic set (AA1 §8a/§17); +1 name, 22 → 23.
- New core dependency: the routing module imports `rankBm25` from
  `@megasaver/retrieval` — the **same** dependency `failed-attempt-search`
  and `project-rule-ranking` already declare, so no new package edge is
  added to `packages/core/package.json`.
- `inputSchema`/`outputSchema` as `z.unknown()` keeps core free of any tool
  I/O contract — the engine stays purely a router.
- `name` reuses `titleSchema`; `keywords` reuse the memory-entry
  normalization verbatim — no new validation primitives.
- Storage adds one dir (`tool-definitions/`) and three store helpers,
  mirroring the Phase 5/6 store additions exactly.

## §10 Risk

HIGH. The router emits a **security-relevant signal** (which tools are safe
to expose); a bug that lets a dangerous tool slip into `allowedTools` is a
real safety regression even though MegaSaver only advises. (Per `CLAUDE.md`
§12, public-surface + safety-signal work is HIGH; this also pulls in
`critic` adversarial review.) Main risks:

1. **Gate totality & precedence.** Every tool must be classified by the
   single `isBlockedTool` boolean, and the gate must run *before*
   relevance so no text match can promote a blocked tool. Covered by §11
   tests: each blocked category, `risk:"dangerous"` in a non-blocked
   category, and a "high text match but blocked → still blocked" case.
2. **No accidental enforcement coupling.** The router must not be wired
   into `mega_run_command` / `@megasaver/policy` or any execution path —
   it is advice only. Covered by keeping the module pure and dependency-
   free of policy, and by the spec's explicit non-goal.
3. **Determinism / stable order.** `allowedTools` (score desc, id tiebreak)
   and `blockedTools` (id order) must be stable across runs and identical
   on both registry impls. Covered by shared registry tests run against
   in-memory and json-directory, plus pure-function ordering tests.
4. **Opaque-schema round-trip.** `z.unknown()` values must survive JSONL
   write→read unchanged and not break `.strict()`. Covered by a store
   round-trip test with a populated `inputSchema`.

## §11 Testing (TDD — tests first)

- **Pure router (`tool-router.ts`):** `isBlockedTool` (true for each of
  `risk:"dangerous"`, `category:"dangerous"`, `category:"deploy"`,
  `category:"database"`; false for a `safe`/`medium` tool in each of the
  six routable categories); `routeToolsForTask` — no query → all non-
  blocked allowed + all blocked listed; with query → only score>0 non-
  blocked tools allowed in descending-score/id-tiebreak order, score≤0
  non-blocked omitted from both lists, blocked tools always in
  `blockedTools` regardless of a strong text match (the security case);
  `reason` string exact-match for each of the three branches; empty tool
  set → empty lists + a sensible reason.
- **Entity schema (`tool-definition.ts`):** `toolDefinitionSchema` (valid
  round-trip incl. opaque `inputSchema`; `keywords` normalized; strict-mode
  unknown-key rejection; bad `category`/`risk` rejected); `toolKeywords`
  de-dup/lowercase/empty-drop; `toolDefinitionInputSchema` (defaults,
  strict rejection, opaque schemas optional).
- **Registry (both impls, shared suite):** `createToolDefinition` (mints
  id, stamps createdAt, requireProject, duplicate id →
  `tool_definition_already_exists`, defaults opaque schemas to null);
  `getToolDefinition`/`listToolDefinitions` (project scoping, null on
  miss); `routeToolsForTask` (delegates to the pure fn, requireProject,
  identical result on both backends). Run identically against in-memory
  and json-directory.
- **Store (`json-directory-store`):** `tool-definitions/<projectId>.jsonl`
  write→read round-trip preserves an opaque `inputSchema`; empty set
  removes the file.
- **MCP handler (`route-tools-for-task.test.ts`):** happy path (allowed +
  blocked + reason), no-task branch, unknown project → resource_not_found,
  bad input → validation_failed.
- **Server e2e:** `ListTools` returns **23**; a `tools add`-seeded project
  (seeded via the registry in the test) round-trips a `route_tools_for_task`
  call through the bridge and shows a dangerous tool in `blockedTools`.
- **CLI:** `mega tools add` prints an id and rejects a bad `--category` /
  `--risk` with a clean message + exit 1; `mega tools list` lists; `mega
  tools route --task` prints allowed/blocked/reason and keeps a dangerous
  tool out of allowed; `mega tools route` with no task allows all safe
  tools; `mega tools explain` renders per-tool block reasons. Follow the
  existing CLI command test patterns (`rules.test.ts`).

## §12 Decisions / open questions

- **Decided:** advisor, not enforcer — the router recommends an
  allow/block split; MegaSaver never intercepts a real tool call.
- **Decided:** `ToolDefinition` is a first-class per-project JSONL entity
  with create/get/list and **no update/delete** this phase (YAGNI).
- **Decided (security):** `isBlockedTool` = `risk === "dangerous"` OR
  `category ∈ {dangerous, deploy, database}`; the gate runs **before**
  relevance and has no override. deploy/database are blocked by category
  because a text match must never authorize production-infra or persistent-
  store mutation (§4b).
- **Decided:** a non-blocked tool that does not match the task is **omitted
  from both lists** (irrelevant ≠ forbidden); only dangerous/deploy/
  database tools populate `blockedTools`.
- **Decided:** `inputSchema`/`outputSchema` are opaque `z.unknown()`,
  descriptive only, defaulted to `null`, never read by the router.
- **Decided:** MCP exposes only `route_tools_for_task` (22 → 23);
  registration is CLI-only to keep the wire surface tight (§7a).
- **Decided:** roadmap `index` verb → CLI `add` (+ `list`), to avoid
  colliding with the existing top-level `mega index` repo-index command
  (§8a).
- **Open (low):** whether to later add `--input-schema`/`--output-schema`
  CLI flags and/or a `save_tool_definition` MCP tool. Deferred — nothing in
  the routing path needs them, and adding them now would be speculative
  surface. Revisit only if a connector needs to round-trip full tool
  schemas through MegaSaver. Not blocking.

## §13 Out of scope

Tool execution / invocation of any kind; enforcement of the allow/block
list at any real call site (the host/agent's job — MegaSaver only
advises); wiring the router into `@megasaver/policy` or `mega_run_command`;
LLM / embeddings; update or delete of a `ToolDefinition`; reading,
validating, or executing `inputSchema`/`outputSchema`; an MCP
`save_tool_definition` tool; audit dashboard and saved-counter metrics
(Phase 8); team/cloud/approval flow (Phase 10).
