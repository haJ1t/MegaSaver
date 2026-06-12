---
title: Phase 5 — FORGE Failed-Run Learning — design
risk: MEDIUM
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-06-11-phase4-mcp-server-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md
  - wiki/syntheses/contextops-roadmap.md
  - MegaSaver_Roadmap.txt
---

# Phase 5 — FORGE Failed-Run Learning — design

## §0 TL;DR

Phase 4 shipped the `FailedAttempt` and `ProjectRule` entities with
create/get/list CRUD and the `record_failed_attempt` / `save_project_rule` /
`get_project_rules` tools. Phase 5 adds the **learning loop** on top: find
similar past failures, convert a failure into a reusable rule, and rank rules
that apply to the current task. Net-new = 2 pure ranking modules, 3 registry
methods (`updateFailedAttempt`, `searchFailedAttempts`, `convertFailureToRule`),
3 MCP tools (tool count 15 → 18), and a CLI surface (`mega fail`, `mega rules`,
`mega learn from-failure`). No LLM, no embeddings — all ranking reuses the
existing `rankBm25` primitive from `@megasaver/retrieval`.

## §1 Motivation

Roadmap Phase 5 ("FORGE-style Failed Run Learning") turns an agent's mistakes
into durable project knowledge. The exit criterion: before repeating a class of
failure, MegaSaver can warn the agent ("Similar previous failure found …
recommended action …"). Phase 4 stored the raw `FailedAttempt`/`ProjectRule`
data but added no retrieval, no conversion, and no scored application — that is
this phase.

The project intelligence is the **calling agent**, not MegaSaver: under the
no-LLM/no-embeddings constraint (Phases 1–3), the engine cannot author rule
prose. So `convert_failure_to_rule` takes the insight the caller writes and does
the deterministic work — linkage, evidence seeding, `appliesTo` defaulting, and
the `convertedToRule` flip.

## §2 Non-goals

- **No LLM, no embeddings, no auto-authored rule prose.** Ranking is `rankBm25`
  + path overlap, consistent with Phases 1–3.
- **No context-pipeline changes.** `get_project_context` already surfaces open
  failures; Phase 5 does not touch the Phase 3 pruner or the context tools.
- **No rule update/delete** beyond the `convertedToRule` flip on the source
  failure. `ProjectRule` stays create-only.
- **No failure delete.** `updateFailedAttempt` patches a small, closed field
  set only.
- **No team/cloud, no approval flow** (Phase 10).

## §3 Pure ranking modules (`packages/core/src/`)

Both are pure functions (no I/O), mirroring `memory-search.ts`, so they unit-test
without a store.

### §3a `failed-attempt-search.ts`

```ts
export type FailedAttemptSearchQuery = {
  text?: string;
  includeConverted?: boolean; // default false: a converted failure already became a rule
  limit?: number;             // default 20
};

export function searchFailedAttempts(
  attempts: readonly FailedAttempt[],
  query: FailedAttemptSearchQuery,
): FailedAttempt[];
```

Filters out `convertedToRule === true` unless `includeConverted`. With a `text`
query: `rankBm25` over `${task} ${failedStep} ${errorOutput ?? ""} ${suspectedCause ?? ""}`,
drop score-0 hits (same convention as `searchMemoryEntries`). With no text:
newest-first by `createdAt`, stable by `id`.

### §3b `project-rule-ranking.ts`

```ts
export type ApplicableRuleQuery = { task?: string; files?: readonly string[] };
export type RankedRule = { rule: ProjectRule; score: number; reason: string };

export function rankApplicableRules(
  rules: readonly ProjectRule[],
  query: ApplicableRuleQuery,
): RankedRule[];
```

Score = path-overlap signal + text signal:
- **Path:** for each `files` entry, if any `rule.appliesTo` glob is a prefix of
  the file or vice-versa, add a fixed weight; `reason` notes the matched path.
- **Text:** if `task` given, `rankBm25(task, [{id, text: title + rule + evidence.join(" ")}])`;
  add the BM25 score; `reason` notes the text match.
- No query (`task` undefined, `files` empty) → return all rules sorted by
  `severity` desc (critical→info), `reason: "no task filter"`.
- Sorted by score desc, then severity desc, then `id` for stability. Zero-score
  rules are dropped when any filter is present.

## §4 Registry methods (`CoreRegistry` + both impls)

Added to the interface and to `createInMemoryCoreRegistry` +
`createJsonDirectoryCoreRegistry`, keeping the two behaviorally identical
(Phase 4 invariant).

```ts
updateFailedAttempt(id: FailedAttemptId, patch: FailedAttemptPatch): FailedAttempt;
searchFailedAttempts(projectId: ProjectId, query: FailedAttemptSearchQuery): FailedAttempt[];
convertFailureToRule(failureId: FailedAttemptId, input: FailureToRuleInput): ConvertResult;
```

- **`FailedAttemptPatch`** (new `failedAttemptPatchSchema`, `.strict()`): closed
  set `{ convertedToRule?, resolution?, suspectedCause? }`. Mirrors
  `updateMemoryEntry`: load → merge → re-parse `failedAttemptSchema` → write,
  under `withDirLock` in the json impl. Throws `failed_attempt_not_found`.
- **`searchFailedAttempts`**: `requireProject` → read the project's failed
  attempts (the same source `listFailedAttempts` uses) → pure
  `searchFailedAttempts(attempts, query)`. Mirrors `searchMemoryEntries`.
- **`convertFailureToRule`** — atomic, single `withDirLock`:
  1. load the failure (`failed_attempt_not_found` if absent);
  2. if `failure.convertedToRule === true` → throw new code
     `failed_attempt_already_converted`;
  3. build a `ProjectRule`: `id = newId` (injected like other create paths),
     `projectId = failure.projectId`, `createdFrom = "failed_attempt"`,
     `appliesTo = input.appliesTo ?? failure.relatedFiles`,
     `evidence = [...(input.evidence ?? []), <seeded line from the failure>]`,
     caller-supplied `title`/`rule`/`severity`/`confidence ?? "medium"`;
  4. `createProjectRule(rule)` (global dup-id check as in Phase 4);
  5. `updateFailedAttempt(failureId, { convertedToRule: true })`;
  6. return `{ rule, failure }`.

  `FailureToRuleInput` (new `failureToRuleInputSchema`, `.strict()`):
  `{ title, rule, severity, confidence?, appliesTo?, evidence? }` — no
  `id`/`projectId`/`createdFrom`/`createdAt` (engine owns those).

  The seeded evidence line is deterministic, e.g.
  `Derived from failed attempt <id> (<createdAt>): <failedStep> — <errorOutput ?? "no error output">`.

New error code: `failed_attempt_already_converted` appended to
`coreRegistryErrorCodeSchema`.

Clock/id injection: the in-memory and json registries already take a `now`/`newId`
the same way create paths do; `convertFailureToRule` uses them so tests are
deterministic.

## §5 MCP tools (`packages/mcp-bridge`, 15 → 18)

Each handler mirrors the Phase 4 tool shape (zod input → resolve project →
registry call → JSON result; read tools use the `throw err` re-throw the server
wraps). New names slot alphabetically into `tool-name.ts` and `TOOL_DEFS`.

| Tool | Input | Output | Backing |
|------|-------|--------|---------|
| `convert_failure_to_rule` | `failureId, title, rule, severity, confidence?, appliesTo?, evidence?` | `{ ruleId, failureId }` | `convertFailureToRule` |
| `find_similar_failures` | `projectId, task, limit?, includeConverted?` | `{ failures }` | `searchFailedAttempts` |
| `get_applicable_rules` | `projectId, task?, files?` | `{ rules: RankedRule[] }` | `rankApplicableRules` over `listProjectRules` |

`get_applicable_rules` is the **scored** counterpart to Phase 4's cheap-filter
`get_project_rules`; both stay. `find_similar_failures` is what lets an agent
warn before repeating a failure (the roadmap exit criterion).

Final enum (18, alphabetic): convert_failure_to_rule, explain_context_selection,
find_similar_failures, get_applicable_rules, get_context_budget_report,
get_project_context, get_project_rules, get_relevant_code_blocks,
get_relevant_context, get_relevant_memories, mega_fetch_chunk, mega_read_file,
mega_recall, mega_run_command, record_failed_attempt, save_memory,
save_project_rule, search_memory.

## §6 CLI (`apps/cli`, citty)

New command groups registered in `apps/cli/src/main.ts` `subCommands`, following
the existing `memory`/`context` command structure (one dir per group, citty
`defineCommand`, shared output helpers in `apps/cli/src/commands/shared/`).

- `apps/cli/src/commands/fail/` → `record`, `list`, `show <id>`.
  `mega fail record` creates a `FailedAttempt` and **warns when
  `searchFailedAttempts` finds similar prior failures** (prints them before
  confirming the new record).
- `apps/cli/src/commands/rules/` → `list`, `add`, `apply`.
  `mega rules apply --task "..." [--files a,b]` prints `rankApplicableRules`
  output (rule + score + reason) and any similar failures as warnings.
- `apps/cli/src/commands/learn.ts` → `mega learn from-failure <id>` with flags
  `--title --rule --severity [--applies-to] [--confidence]`; calls
  `convertFailureToRule` and prints the created rule id + the flipped failure.

CLI resolves the active project the same way existing commands do (the shared
project-resolution helper). No new resolution logic.

## §7 Reconciliation

- Tool enum stays a closed alphabetic set (AA1 §8a/§17); +3 names.
- `ProjectRule.createdFrom = "failed_attempt"` is already a valid enum member
  (Phase 4 §3) — convert uses it, no schema change.
- `FailedAttempt.convertedToRule` flips false→true exactly once; the guard in §4
  prevents double-convert.
- No new cross-package dependency: core already depends on `@megasaver/retrieval`
  (via `memory-search.ts`); mcp-bridge and cli already depend on core.

## §8 Risk

MEDIUM. Additive — no existing schema/store/tool changes shape. Main risks:
(1) `convertFailureToRule` must be atomic (rule create + failure flip in one
lock) so a crash can't leave a rule with an un-flipped failure; covered by a
test asserting both sides commit together and a double-convert rejection.
(2) `updateFailedAttempt` is the first mutation of a `FailedAttempt` file — it
must follow the `updateMemoryEntry` read-merge-reparse-write pattern exactly.
(3) Ranking determinism (stable sort) so CLI/tool output is reproducible.

## §9 Testing (TDD — tests first)

- **Pure ranking:** `searchFailedAttempts` (text BM25, no-text newest-first,
  `includeConverted` filter, score-0 drop); `rankApplicableRules` (path match,
  text match, no-query severity sort, stable order, zero-score drop).
- **Registry (both impls):** `updateFailedAttempt` (patch fields, not-found);
  `searchFailedAttempts` (requireProject, project scoping); `convertFailureToRule`
  (creates rule with seeded evidence + `createdFrom`, flips failure, atomic,
  rejects double-convert, not-found). Run identically against in-memory and
  json-directory via the shared suite.
- **MCP handlers:** one test file — `convert_failure_to_rule` (happy + bad input
  + already-converted), `find_similar_failures` (ranked, unknown project →
  resource_not_found), `get_applicable_rules` (scored + reason, unknown project).
- **Server e2e:** `ListTools` returns 18; each new tool callable end-to-end;
  a record → find_similar_failures → convert_failure_to_rule → get_applicable_rules
  round-trip through the bridge.
- **CLI:** `mega fail record` similar-failure warning; `mega learn from-failure`
  creates a rule and flips; `mega rules apply` scored output. Follow the existing
  CLI command test patterns.

## §10 Decisions / open questions

- **Decided:** caller-supplied rule insight; engine does linkage only (no prose).
- **Decided:** `find_similar_failures` is a distinct tool (not folded into
  `get_applicable_rules`) — failures and rules are different result shapes.
- **Decided:** `get_applicable_rules` (scored) coexists with `get_project_rules`
  (filter) rather than replacing it — avoids breaking the Phase 4 surface.
- **Decided:** double-convert is an error (`failed_attempt_already_converted`),
  not a silent second rule.
- **Open (low):** path-overlap vs BM25 weight balance in `rankApplicableRules`
  — start with path-match weighted above text, tune if CLI output looks wrong.

## §11 Out of scope

LLM/embeddings, auto-authored rule prose, context-pipeline/pruner changes, rule
update/delete, failure delete, Phase 6 task engine, team/cloud/approval flow.
