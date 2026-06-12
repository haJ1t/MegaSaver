---
title: Phase 8 — Context Audit & Token-Savings Dashboard — design
risk: HIGH
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-06-12-phase7-tool-router-design.md
  - docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - wiki/syntheses/contextops-roadmap.md
  - wiki/entities/stats.md
  - wiki/entities/context-pruner.md
---

# Phase 8 — Context Audit & Token-Savings Dashboard — design

## §0 TL;DR

Phase 8 turns MegaSaver's scattered savings signals into **one
deterministic, persisted, windowed audit summary** that answers the
roadmap's exit demo: *"this task would've been 70k tokens, was 23k, 67%
saved."*

The shipped `@megasaver/stats` already owns an append-only event log
(`<store>/stats/<projectId>/<sessionId>.events.jsonl`), atomic summary
writes, `StatsError`, and a core re-export path that `apps/cli` and
`@megasaver/mcp-bridge` already use. Phase 8 **extends that package** —
decision (a), §6 — rather than standing up a parallel `AuditEvent`
entity in core. We add:

- **A second, additive event family** `AuditEvent` (a discriminated
  union of five scalar-only event kinds) written to a **sibling** log
  `<store>/stats/<projectId>/<sessionId>.audit.jsonl`, alongside one
  `appendAuditEvent` writer that mirrors the existing `appendEvent`
  JSONL mechanics. The existing `TokenSaverEvent` byte-log and its
  `SessionTokenSaverStats` byte-summary are **untouched** (no
  duplication of token-saver accounting — §6).
- **A pure summarizer** `summarizeAudit(events, opts)` — arithmetic +
  grouping over recorded `AuditEvent`s, with window filtering
  (`session | week | all`). Unit-testable with no store, mirroring
  `auditPack` / `rankApplicableRules` / `routeToolsForTask`.
- **A thin store reader** `readAuditEvents(store, projectId, sessionId?)`
  that loads the JSONL line-by-line (rejecting a partial tail, exactly
  like the existing summary reader) so `summarizeAudit` stays pure.
- **Core re-exports** of the four new symbols (apps must not import
  `@megasaver/stats` directly — cycle guard, §3c of AA1).
- **One read-only MCP tool** `audit_token_usage` (closed enum **23 →
  24**), and a **`mega audit` CLI group** (`report`, `last`,
  `session <id>`, `export --format json`).

Net-new = additive event schema + 1 pure summarizer + 1 store reader in
`@megasaver/stats`; 4 core re-exports; 1 MCP tool; 1 CLI group. **No new
core entity, no LLM, no estimator of our own** (we reuse the
context-pruner line-span estimator — §2, §4d). The GUI already has a
token-saver view; extending it is **out of scope** and flagged as a
follow-up (§13).

## §1 Motivation & philosophy — prove the savings, don't re-measure them

Roadmap Phase 8 ("Context Audit & Token-Savings Dashboard") is the
*"prove the savings"* surface. Every prior phase already produces a
savings signal in passing — Phase 3 prunes a context pack, Phase 5
avoids a repeated failure, Phase 1 retrieves a memory, Phase 7 trims a
tool-schema set — but those signals are **ephemeral**: computed, shown
once, and discarded. There is no place a developer can ask *"across this
whole task / this week, how much did MegaSaver actually save me?"*
(source: wiki/syntheses/contextops-roadmap.md:153-164).

Phase 8 is therefore an **aggregator, not a new measurer.** The
governing constraints:

- **Deterministic, no LLM.** The summary is pure arithmetic and grouping
  over recorded events. No estimation magic. Where a number needs a
  token estimate (Phase 3's `tokensBefore`/`tokensAfter`), the producing
  phase already computed it with the codebase's one estimator
  (`estimateSpanTokens`, `~12 tokens/line`,
  `packages/context-pruner/src/select.ts:21`); Phase 8 records and adds
  those numbers — it never re-estimates (§2, §4d).
- **Record at the source, summarize on read.** Each phase emits a small,
  scalar `AuditEvent` *when its savings event happens* (a pack is built,
  a failure is avoided, a memory is retrieved, a tool route is
  computed). Phase 8 only reads the log and folds it. This keeps the
  measurement local to the phase that knows the truth and keeps Phase 8
  a thin, total function.
- **Append-only evidence.** Like the existing token-saver log, the audit
  log is append-only JSONL — the raw events are the audit trail; the
  summary is derived, never the source of truth (matches the
  evidence-preserving principle in wiki/entities/stats.md and CLAUDE.md
  §13 "we preserve evidence").

## §2 The token estimator — reused, never reinvented (mandatory constraint)

The codebase has exactly one token estimator:
`estimateSpanTokens(startLine, endLine) = max(1, (endLine - startLine +
1) * 12)` and its block wrapper `estimateBlockTokens`, in
`packages/context-pruner/src/select.ts:21-27`. `auditPack`
(`packages/context-pruner/src/audit.ts`) already uses it to compute
`PackAudit.tokensBefore` (every considered block's estimated tokens) and
`tokensAfter` (`pack.budget.usedTokens`).

Phase 8 **does not call the estimator at all.** The `tokensBefore` /
`tokensAfter` numbers reach the audit log already-estimated, carried
verbatim from `PackAudit` into a `context_pack_built` audit event at the
point the pack is built (§4a/§7a). Re-estimating in Phase 8 would (a)
duplicate the estimator across packages, (b) risk drift if the estimator
is upgraded, and (c) violate "no estimation magic." So the only place
tokens are estimated stays Phase 3; Phase 8 is downstream arithmetic on
integers.

> **Consequence:** `@megasaver/stats` gains **no** dependency on
> `@megasaver/context-pruner`. The estimated integers are passed *into*
> `appendAuditEvent` by the caller (the context-gate / context-pruner
> wiring that already holds the `PackAudit`), exactly as the existing
> `appendEvent` receives already-computed `bytesSaved`. Stats stays a
> leaf package (§3c cycle guard, §6).

## §3 Non-goals

- **No new core entity / `AuditEvent` in `@megasaver/core`.** Decision
  (a) is taken (§6): the audit log lives in `@megasaver/stats`. Core
  gains only re-exports, no schema, no registry method, no store dir.
- **No LLM, no embeddings, no estimation.** Summarization is integer
  arithmetic + grouping. The one token estimate is reused, not
  recomputed (§2).
- **No re-measurement / no duplicate token-saver accounting.** The
  existing `TokenSaverEvent` byte-log and `SessionTokenSaverStats`
  remain the source for byte savings; Phase 8 **reads** the byte-summary
  for the dashboard's byte line but never re-derives it and never writes
  a `TokenSaverEvent`.
- **No write/mutation surface on the wire.** Emitting `AuditEvent`s is
  the job of the producing phases' existing wiring (CLI/MCP call sites
  that already run a pack build, a route, etc.); the **only** Phase-8
  MCP tool is the read-only `audit_token_usage`. No `record_audit_event`
  MCP tool (parity with Phase 7's CLI-only registration rationale, §7c).
- **No GUI work.** The GUI's `TokenSaverStats` view is noted as the
  natural future home for these numbers but is **not** extended this
  phase (§13). Deliverable = core + stats + CLI + MCP.
- **No backfill / historical reconstruction.** Sessions that ran before
  Phase 8 shipped have no `.audit.jsonl`; their audit summary is the
  empty/zero summary. We do not retro-synthesize events from other logs.
- **No retention / rotation / pruning of the audit log** (YAGNI; same
  posture as the existing events log, which is never rotated).

## §4 The audit event family (`packages/stats/src/audit-event.ts`)

### §4a Shape decision — a discriminated union of scalar events

An `AuditEvent` is **not** a core entity and carries **no core types**
(it must not, per the §3c cycle guard — §6). It is a small JSON record
with a `kind` discriminant and a scalar payload. Five kinds, one per
roadmap metric source:

```ts
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

// Common envelope on every audit event. ids reuse the shared branded
// id schemas (the only @megasaver dep stats already declares besides
// output-filter). createdAt is an ISO-8601 offset timestamp — the same
// shape TokenSaverEvent.createdAt uses — so window filtering (§4c) is a
// pure string/Date comparison with no extra clock.
const auditEventBase = {
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.string().datetime({ offset: true }),
};

// Phase 3 — context pruning. Carries the PackAudit integers verbatim
// (already estimated by estimateSpanTokens; §2). No re-estimation here.
export const contextPackBuiltEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("context_pack_built"),
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
  })
  .strict();

// Phase 5 — FORGE. One event per applicable rule injected into context.
export const ruleAppliedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("rule_applied") })
  .strict();

// Phase 5 — FORGE. One event per repeated failure avoided (a matching
// FailedAttempt/ProjectRule warned the agent off re-running a known-bad
// action). retryTokensAvoided is the estimated token cost of the retry
// that did NOT happen — supplied by the caller (it already estimated the
// failed run's output cost); 0 when unknown. Never re-estimated here.
export const failureAvoidedEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("failure_avoided"),
    retryTokensAvoided: z.number().int().nonnegative(),
  })
  .strict();

// Phase 1 — DIMMEM. One event per memory retrieved into context.
export const memoryRetrievedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("memory_retrieved") })
  .strict();

// Phase 7 — Tool Router. One event per route decision. toolSchemasReduced
// = (registered tools) - (allowedTools) for that route — the count of tool
// schemas kept OUT of the agent's context by the route.
export const toolRouteEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("tool_route"),
    toolsConsidered: z.number().int().nonnegative(),
    toolsAllowed: z.number().int().nonnegative(),
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export const auditEventSchema = z.discriminatedUnion("kind", [
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
]);

export type AuditEvent = z.infer<typeof auditEventSchema>;
```

**Why a discriminated union (not five tables, not one wide row):** the
log is one append-only stream per session; a `kind` discriminant lets
heterogeneous events share one file and one reader, and lets
`summarizeAudit` fold them in a single pass with an exhaustive `switch`
(the compiler enforces totality when a sixth kind is added). `.strict()`
on each member rejects unknown keys; `z.discriminatedUnion` gives a
clean parse error on an unknown `kind`. This mirrors how
`TaskStep`/`ToolDefinition` use closed shapes, scaled to a union.

### §4b The summary shape — every roadmap metric, named exactly

```ts
export const auditWindowSchema = z.enum(["session", "week", "all"]);
export type AuditWindow = z.infer<typeof auditWindowSchema>;

export const auditSummarySchema = z
  .object({
    window: auditWindowSchema,
    eventsTotal: z.number().int().nonnegative(),
    // Phase 3 — context pruning (summed across context_pack_built events)
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    tokensSaved: z.number().int().nonnegative(),
    percentageSaved: z.number().min(0).max(100),
    // Phase 5 — FORGE
    repeatedFailuresAvoided: z.number().int().nonnegative(),
    rulesApplied: z.number().int().nonnegative(),
    retryCostSaved: z.number().int().nonnegative(),
    // Phase 1 — DIMMEM
    memoriesRetrieved: z.number().int().nonnegative(),
    // Phase 7 — Tool Router
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export type AuditSummary = z.infer<typeof auditSummarySchema>;
```

`tokensBefore`/`tokensAfter` are summed from `context_pack_built` events;
`tokensSaved = tokensBefore - tokensAfter` (floored at 0 — a pack can
never use more than it considered, but the floor makes the function
total); `percentageSaved = tokensBefore > 0 ? round((tokensSaved /
tokensBefore) * 100) : 0` (same formula and rounding as
`PackAudit.percentSaved`, so the dashboard and the per-pack
`mega context audit` agree).

### §4c Pure summarizer (`packages/stats/src/audit-summary.ts`)

```ts
export type SummarizeAuditOptions = {
  window: AuditWindow;
  // Injected so windowing is deterministic and testable (no Date.now()
  // at call time) — mirrors the `now` injection in token-saver.ts.
  now: () => string;
};

export function summarizeAudit(
  events: readonly AuditEvent[],
  opts: SummarizeAuditOptions,
): AuditSummary;
```

Algorithm (pure, single pass, no I/O):

1. **Window filter.** `session | all` → no time filter (the caller has
   already scoped events to one session for `session`, or passed every
   session's events for `all` — §5). `week` → keep events whose
   `createdAt >= now() - 7 days` (ISO compare via `Date.parse`; events
   with no parseable date are impossible because the schema enforced
   `datetime({offset:true})` on read).
2. **Fold.** One `switch (event.kind)` accumulating:
   - `context_pack_built` → add all eight pack integers + `tokensBefore`
     / `tokensAfter`.
   - `rule_applied` → `rulesApplied += 1`.
   - `failure_avoided` → `repeatedFailuresAvoided += 1`,
     `retryCostSaved += event.retryTokensAvoided`.
   - `memory_retrieved` → `memoriesRetrieved += 1`.
   - `tool_route` → `toolSchemasReduced += event.toolSchemasReduced`.
   - every kind → `eventsTotal += 1`.
3. **Derive.** `tokensSaved = max(0, tokensBefore - tokensAfter)`;
   `percentageSaved` per §4b.
4. Parse the result through `auditSummarySchema` (boundary discipline)
   and return it.

The `switch` is exhaustive over the union; adding a sixth event kind is
a compile error until the fold handles it (totality guard). The function
takes `readonly AuditEvent[]` and returns a plain object — **no store,
no fs, no clock beyond the injected `now`** — so it unit-tests directly,
exactly like `auditPack(pack)` and `routeToolsForTask(tools, query)`.

### §4d Where each token number comes from (no estimation in Phase 8)

| Number | Origin | Estimator |
|--------|--------|-----------|
| `tokensBefore` / `tokensAfter` | `PackAudit` (Phase 3) carried into a `context_pack_built` event | `estimateSpanTokens` (context-pruner), **at pack-build time** |
| `retryTokensAvoided` | caller's estimate of the avoided failed-run output cost, carried into a `failure_avoided` event | producing phase's existing estimate; `0` when unknown |
| every count (`rulesApplied`, `memoriesRetrieved`, `toolSchemasReduced`, …) | integer increments | none — pure counting |

Phase 8 imports **no estimator** and computes **no token estimate.**

## §5 Store reader (`packages/stats/src/audit-store.ts`)

The audit log is a **sibling** of the existing events log, same directory
layout and same JSONL durability semantics:

```
<store>/stats/<projectId>/<sessionId>.events.jsonl   (existing — byte token-saver events; UNTOUCHED)
<store>/stats/<projectId>/<sessionId>.audit.jsonl    (NEW — AuditEvent stream)
```

```ts
import type { ProjectId, SessionId } from "@megasaver/shared";
import { type AuditEvent } from "./audit-event.js";
import { type StatsStore } from "./store.js";

export type AppendAuditEventInput = { store: StatsStore; event: AuditEvent };

// Append-only, line-terminated JSONL — same mechanics as appendEvent:
// validate via auditEventSchema (throws StatsError "schema_invalid" on a
// bad event), mkdir -p the parent, appendFileSync one `${json}\n` line.
// NOTE: unlike appendEvent there is NO running .json summary written here
// — the audit summary is always derived on read by summarizeAudit, so
// there is nothing to keep in sync and no second atomic write.
export function appendAuditEvent(input: AppendAuditEventInput): void;

// Read one session's audit events (sessionId given) or, when sessionId is
// omitted, every session's audit events under the project (for window
// "all"/"week" across a project). Parses each terminated line through
// auditEventSchema; a partial (non-terminated) trailing line is dropped
// (crash-safety, identical to the summary reader's split-on-"\n" + drop-
// last rule); a corrupt fully-terminated line throws StatsError
// "store_corrupt".
export function readAuditEvents(
  store: StatsStore,
  projectId: ProjectId,
  sessionId?: SessionId,
): AuditEvent[];
```

`readAuditEvents` is the **only** disk read; it returns a plain array
that the CLI/MCP boundary hands to `summarizeAudit`. This split (impure
reader + pure summarizer) is the same shape the repo uses for `loadPack`
+ `auditPack` and for the registry-read + pure-rank pattern. The reader
glob for the no-`sessionId` case lists `*.audit.jsonl` in
`<store>/stats/<projectId>/` (mirrors how the store already keys by
`projectId/sessionId`).

> **Why no running summary `.json` (unlike the byte log):** the byte log
> keeps a folded `SessionTokenSaverStats` because the GUI bridge reads it
> hot and folding-on-every-append is cheaper there. The audit summary,
> by contrast, is windowed (`session | week | all`) — a single stored
> fold could not serve all three windows, and the event volume per
> session is tiny (a handful of packs/rules/routes), so deriving on read
> is both correct for every window and cheap. One mechanism, no
> summary-drift risk.

## §6 Reconciliation (the central design decision)

### §6a Decision: (a) extend `@megasaver/stats` — taken

We **extend `@megasaver/stats`** with an additive `AuditEvent` family +
pure summarizer + reader, and re-export the public surface through
`@megasaver/core`. We do **not** create a first-class `AuditEvent` core
entity (option (b)). Justification (reuse the most machinery, add the
least parallel infrastructure — YAGNI):

1. **`@megasaver/stats` is already the savings ledger.** It owns the
   append-only JSONL log, the atomic-write helper, `StatsError` + its
   codes, the `<store>/stats/<projectId>/<sessionId>.*` layout, and the
   JSONL partial-tail durability rule. Phase 8's log is *the same kind of
   thing* — a per-session append-only savings stream — so it slots in as
   a sibling file and reuses every one of those mechanisms. Option (b)
   would re-implement all of it in core (a second store dir, a second
   JSONL convention, a second error taxonomy) for no behavioural gain.
2. **The cycle guard makes (a) clean, not a compromise.** `stats`'
   dependency allow-list is exactly `@megasaver/output-filter`,
   `@megasaver/shared`, `zod`, and it is forbidden from importing
   `@megasaver/core` (enforced by `packages/stats/test/dependency-
   graph.test.ts`). `AuditEvent` carries **only scalars + shared branded
   ids**, so it needs none of core's types — it lives happily under that
   allow-list. The audit numbers that *originate* in core-adjacent phases
   (rule counts, tool-route counts) arrive as plain integers passed into
   `appendAuditEvent` by the caller, exactly as `bytesSaved` arrives
   today. No new package edge is added to `stats`.
3. **The read path already exists.** `apps/cli` is forbidden from
   importing `@megasaver/stats` directly and instead consumes
   `appendEvent`/`readSummary` via `@megasaver/core` re-exports
   (`packages/core/src/context-gate.ts`). The four new symbols
   (`auditEventSchema`/`AuditEvent`, `summarizeAudit`/`AuditSummary`,
   `appendAuditEvent`, `readAuditEvents`) follow the **same** re-export
   path — zero new dependency-graph exceptions for CLI or MCP.
4. **No duplicate token-saver accounting.** The existing
   `TokenSaverEvent` byte-log stays the sole source for *byte* savings;
   Phase 8 adds *token/file/block/rule/memory/tool* metrics that the byte
   log never tracked (wiki/entities/stats.md: "the shipped stats are
   token-byte only"). The two logs are orthogonal and never overlap, so
   nothing is measured twice.

Option (b) is rejected: it would duplicate the entire stats storage
layer in core, add a parallel error taxonomy, and gain nothing — the
only thing core would offer that stats cannot is access to core entity
types, which `AuditEvent` deliberately does not need.

### §6b Every roadmap metric → its source (reused signal vs new event)

| Roadmap metric | Source | New event? | Notes |
|----------------|--------|-----------|-------|
| `tokensBefore` | `context_pack_built.tokensBefore` ← `PackAudit.tokensBefore` (Phase 3) | **new event**, reused number | estimated by `estimateSpanTokens` at pack build (§2) |
| `tokensAfter` | `context_pack_built.tokensAfter` ← `PackAudit.tokensAfter` | **new event**, reused number | `pack.budget.usedTokens` |
| `tokensSaved` | derived `tokensBefore − tokensAfter` | derived | floored at 0 |
| `percentageSaved` | derived (§4b formula) | derived | same formula as `PackAudit.percentSaved` |
| `filesConsidered/Included/Excluded` | `context_pack_built.files*` ← `PackAudit.files*` | **new event**, reused number | summed across packs |
| `blocksConsidered/Included/Excluded` | `context_pack_built.blocks*` ← `PackAudit.blocks*` | **new event**, reused number | summed across packs |
| `repeatedFailuresAvoided` | count of `failure_avoided` events | **new event** (count) | emitted when a `FailedAttempt`/`ProjectRule` (Phase 5) warns the agent off a known-bad action |
| `rulesApplied` | count of `rule_applied` events | **new event** (count) | emitted per applicable `ProjectRule` injected (Phase 5 `getApplicableRules`) |
| `retryCostSaved` | sum of `failure_avoided.retryTokensAvoided` | **new event** (number) | caller's estimate of the avoided retry's output cost; 0 when unknown |
| `memoriesRetrieved` | count of `memory_retrieved` events | **new event** (count) | emitted per `MemoryEntry` (Phase 1) retrieved into context |
| `toolSchemasReduced` | sum of `tool_route.toolSchemasReduced` | **new event** (number) | `registered − allowed` per route (Phase 7 `routeToolsForTask`) |

The **byte** savings (`rawBytesTotal`/`bytesSavedTotal`/`savingRatio`)
remain sourced from the **existing** `TokenSaverEvent` summary via
`readSummary`; the dashboard's byte line reuses that signal unchanged
(§7b) — no new event, no re-measurement.

### §6c What is new vs reused

- **Reused unchanged:** `StatsStore`, `atomicWriteFile`, `StatsError` +
  codes, the JSONL line/partial-tail durability rule, the
  `<store>/stats/<projectId>/…` layout, `estimateSpanTokens` (indirectly,
  via Phase 3), `SessionTokenSaverStats` + `readSummary` (for the byte
  line), the core re-export pattern, the MCP `{ registry, storeRoot }`
  handler env, and the citty CLI-group scaffolding.
- **New (additive only):** `audit-event.ts` (union schema),
  `audit-summary.ts` (pure `summarizeAudit`), `audit-store.ts`
  (`appendAuditEvent` + `readAuditEvents`), the four core re-exports, the
  `audit_token_usage` MCP tool (+1 enum), the `mega audit` CLI group, and
  the producing-phase emission calls (§7a). **Nothing existing changes
  behaviour.**

### §6d Emission wiring — additive, at existing call sites

The producing phases already have the data at a natural call site; Phase
8 only adds a fire-after-the-fact `appendAuditEvent`:

- **`context_pack_built`** — emitted where a pack is built and
  `auditPack` is (or can be) called: the context-gate / `mega context
  build` path that already holds the `ContextPack`. (`mega context audit`
  computes `PackAudit` ephemerally; the *build* path is where we persist
  it.)
- **`rule_applied` / `failure_avoided`** — at the Phase-5 surface that
  returns applicable rules / similar failures into context
  (`getApplicableRules`, `findSimilarFailures`).
- **`memory_retrieved`** — at the Phase-1 retrieval surface
  (`searchMemoryEntries` / `get_relevant_memories`).
- **`tool_route`** — at the Phase-7 route surface (`routeToolsForTask` /
  `route_tools_for_task`), where `toolsConsidered`/`toolsAllowed` are in
  hand.

> **Scope note (important):** wiring emission into *every* producing call
> site is a broad change touching many packages. This spec defines the
> event family, the writer, the summarizer, the reader, the CLI, and the
> MCP tool as the Phase-8 deliverable, plus **one** representative
> emission (the `context_pack_built` event on the build path) to prove
> the end-to-end loop in the exit demo. The remaining four emissions
> (`rule_applied`, `failure_avoided`, `memory_retrieved`, `tool_route`)
> are **declared here and wired as a fast follow** so each lands with its
> own focused test rather than bloating this PR — the summarizer already
> handles all five kinds, so the follow-ups are pure call-site additions
> with no schema change. This keeps Phase 8 shippable and honest about
> what proves the demo today vs. what completes the metric set. (See §12
> Decisions and §13 Out of scope.)

## §7 Surfaces

### §7a Stats package public surface (`packages/stats/src/index.ts` additions)

```ts
export {
  auditEventSchema,
  type AuditEvent,
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
} from "./audit-event.js";

export {
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
  summarizeAudit,
  type SummarizeAuditOptions,
} from "./audit-summary.js";

export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
} from "./audit-store.js";
```

### §7b Core re-export (`packages/core/src/context-gate.ts`, append to the existing stats re-export block)

```ts
export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
  summarizeAudit,
  type SummarizeAuditOptions,
  auditEventSchema,
  type AuditEvent,
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
} from "@megasaver/stats";
```

This extends the existing allow-listed re-export block (the comment there
already documents "apps/cli depends on core, never on @megasaver/stats
directly"). No new package edge — `@megasaver/core` already depends on
`@megasaver/stats`.

The dashboard's optional **byte line** reuses the already-exported
`readSummary` + `SessionTokenSaverStats` for the `session` window only
(byte savings are session-summary, not windowed); for `week`/`all` the
byte line is omitted (the byte log has no per-window fold and Phase 8
adds none — §3 no re-measurement).

### §7c MCP tool (`packages/mcp-bridge`, 23 → 24)

**One** new read-only tool, `audit_token_usage`, mirroring the Phase 4/7
read-tool shape (zod input → resolve project/session → read events → pure
summarize → JSON). It slots **alphabetically** into `tool-name.ts`,
`TOOL_DEFS`, the dispatch switch, and the `test-d` tuple.

`audit_token_usage` sorts **first** in the alphabetic enum (before
`build_task_plan`). Final enum (**24**, alphabetic): **audit_token_usage**,
build_task_plan, convert_failure_to_rule, explain_context_selection,
find_similar_failures, get_applicable_rules, get_context_budget_report,
get_project_context, get_project_rules, get_relevant_code_blocks,
get_relevant_context, get_relevant_memories, get_task_status,
mega_fetch_chunk, mega_read_file, mega_recall, mega_run_command,
record_failed_attempt, record_task_step, retry_failed_step,
route_tools_for_task, save_memory, save_project_rule, search_memory.

| Tool | Input | Output | Backing |
|------|-------|--------|---------|
| `audit_token_usage` | `{ projectId: string, sessionId?: string, window?: "session"\|"week"\|"all" }` (`.strict()`) | `AuditSummary` (`{ tokensBefore, tokensAfter, tokensSaved, percentageSaved, … }`) | `readAuditEvents` + `summarizeAudit` |

- Handler env is `{ registry, storeRoot }` (same as `mega_read_file` /
  `recall` — it needs `storeRoot` to read the JSONL and `registry` to
  resolve/validate the project, and the session when `window:"session"`).
- **Window/sessionId contract:** `window:"session"` requires
  `sessionId` (read that one `.audit.jsonl`); `window:"week"|"all"` omit
  `sessionId` and read every `.audit.jsonl` under the project. Default
  `window` is `"session"` when `sessionId` is given, else `"all"`.
- **Closed-enum validation at the boundary:** `auditWindowSchema.safe
  Parse(window)` → on failure `McpBridgeError("validation_failed", …)`
  with the `(session | week | all)` hint (never a raw zod dump).
- Error mapping (parity with every other handler):
  `project_not_found` → `resource_not_found`; any other error →
  `validation_failed`. A `StatsError("store_corrupt")` from a corrupt log
  maps to `validation_failed` with the underlying message.
- **Read-only:** the tool never writes; emission is not on the wire (no
  `record_audit_event` tool — parity with Phase 7 §7a keeping the wire
  surface tight and audited; events are emitted by the producing phases'
  own wiring, §6d).

### §7d CLI (`apps/cli`, citty) — `mega audit` group

New command group `mega audit` registered in `apps/cli/src/main.ts`
`subCommands`, following the `tools` / `task` group structure (one dir,
`defineCommand`, `run<Name>(input): Promise<0 | 1>`, shared output
helpers, `mapErrorToCliMessage` / `projectNotFoundMessage` /
`sessionNotFoundMessage` / `ensureStoreReady` / `resolveStorePath` /
`readStoreEnv`). Store reads go through the `@megasaver/core` re-exports
(`readAuditEvents`, `summarizeAudit`), never `@megasaver/stats` directly.

`apps/cli/src/commands/audit/` → `report`, `last`, `session`, `export`
(+ `shared.ts`, `index.ts`). Roadmap verb mapping (`mega audit` / `audit
last` / `audit session <id>` / `audit export --format json` / `audit
report`):

- **`mega audit report <project> [--window session|week|all] [--session
  <id>] [--json]`** — the dashboard summary (roadmap `mega audit` /
  `audit report`). Resolves the project by name; reads audit events for
  the window; pure-summarizes; prints the **dashboard cards** as aligned
  text blocks (Context / FORGE / Memory / Tools sections) ending with the
  headline line. With `--window session` (default when `--session` given)
  it also reads the byte summary (§7b) for the byte line.
  - **Closed-enum validation:** `auditWindowSchema.safeParse(--window)`
    fails with `error: invalid window "<x>" (session | week | all)` and
    exit 1 — never a raw zod dump (Phase 5/6/7 lesson). The roadmap's
    `--format json` is realized as `--json` here for consistency with
    every other `mega` command; `export` additionally accepts the
    roadmap's literal `--format json` (§ below).
  - Headline line (the exit-criterion demo string):
    `would've been <tokensBefore> tokens, was <tokensAfter>, <percentageSaved>% saved`.
- **`mega audit last <project> [--json]`** — the most recent session's
  audit summary (`window:"session"` over the project's newest session by
  `createdAt` from `registry.listSessions(projectId)`). Roadmap `audit
  last`.
- **`mega audit session <id> [--json]`** — one session's audit summary
  (`window:"session"`, that session id). Resolves the session, validates
  the id via `sessionIdSchema.safeParse` at the boundary (clean message +
  exit 1 on a bad id). Roadmap `audit session <id>`.
- **`mega audit export <project> --format json [--session <id>] [--window
  …]`** — emits the raw `AuditSummary` (and, for a session window, the
  underlying event array) as JSON to stdout. The roadmap names `export
  --format json`; **closed-enum validation** on `--format`:
  `safeParse` against `z.enum(["json"])` → on anything else
  `error: invalid format "<x>" (json)` + exit 1 (json is the only
  supported format this phase; CSV etc. are a YAGNI follow-up).

Each command prints either the human cards or, with `--json`, the
`AuditSummary` verbatim. CLI resolves the active project by name the same
way existing commands do (`registry.listProjects().find(p => p.name ===
projectName)`); no new resolution logic.

## §8 Determinism & purity (mandatory constraints)

- `summarizeAudit(events, { window, now })` is **pure**: no I/O, no
  ambient clock (the `now` is injected), output is a function of inputs
  only. Window `week` uses the injected `now`, so a test pins it.
- The fold is integer arithmetic + counting; the only division is
  `percentageSaved`, guarded by `tokensBefore > 0` and rounded with
  `Math.round` — identical to `PackAudit.percentSaved`, so a pack's
  per-task percent and the dashboard's summed percent use the same rule.
- `readAuditEvents` is the sole impure boundary; it returns a plain
  array. The reader's partial-tail drop and corrupt-line `store_corrupt`
  behaviour are copied verbatim from the existing summary reader (no new
  durability semantics invented).

## §9 Risk

HIGH. Phase 8 is the **"prove the savings" headline surface** — a wrong
number here is a credibility bug for the whole product, and it touches a
public CLI surface + the MCP wire enum (CLAUDE.md §12: public-surface +
the headline metric work is HIGH; pulls in `critic` adversarial review).
Main risks + mitigations:

1. **Double-counting / wrong arithmetic.** A metric summed from the
   wrong event kind, or `tokensSaved` going negative. Mitigated by the
   exhaustive `switch` (compile-time totality), the `max(0, …)` floor,
   and §11 tests that fold a known multi-kind event set and assert every
   field.
2. **Estimator drift / reinvention.** Re-estimating tokens in Phase 8
   would diverge from Phase 3. Mitigated by carrying `PackAudit`
   integers verbatim and importing **no** estimator (§2); a test asserts
   the `context_pack_built` numbers round-trip into the summary
   unchanged.
3. **Cycle-guard violation.** Accidentally importing a core type into
   `stats`. Mitigated by `AuditEvent` being scalar+shared-id only and by
   the existing `packages/stats/test/dependency-graph.test.ts` (extended
   to assert the allow-list still holds after the additions).
4. **Touching the byte log.** A regression in `appendEvent` /
   `SessionTokenSaverStats`. Mitigated by `appendAuditEvent` writing a
   **separate** `.audit.jsonl` and writing **no** summary `.json`, so the
   byte log's files and folding code are never opened; the existing
   `store.test.ts` stays green untouched.
5. **Window correctness.** `week` boundary off-by-one or timezone bug.
   Mitigated by ISO-offset timestamps + injected `now` + a test pinning
   `now` and asserting an event just inside / just outside the 7-day
   window.

## §10 Testing (TDD — tests first)

- **Event schema (`audit-event.ts`):** each of the five members
  round-trips a valid record; `discriminatedUnion` rejects an unknown
  `kind`; `.strict()` rejects an unknown key; `context_pack_built`
  rejects a negative integer; ids must be branded session/project ids.
- **Summarizer (`audit-summary.ts`) — the core unit suite:** empty
  events → all-zero summary with `percentageSaved` 0; a single
  `context_pack_built` → its integers surface, `tokensSaved` /
  `percentageSaved` derived (match `PackAudit` formula on the same
  numbers); multiple packs sum; `rule_applied`×3 → `rulesApplied` 3;
  `failure_avoided` → `repeatedFailuresAvoided`+`retryCostSaved` sum;
  `memory_retrieved`×N → `memoriesRetrieved` N; `tool_route` →
  `toolSchemasReduced` sum; a mixed multi-kind set → every field exact;
  `tokensAfter > tokensBefore` (impossible in practice) → `tokensSaved`
  floored at 0; **window `week`** with injected `now` → an event dated 8
  days ago excluded, 6 days ago included; `window:"all"`/`"session"` →
  no time filter.
- **Store (`audit-store.ts`):** `appendAuditEvent` writes a terminated
  JSONL line to `<store>/stats/<projectId>/<sessionId>.audit.jsonl` and
  does **not** create/modify the byte `.events.jsonl` or `.json`;
  `readAuditEvents(store, project, session)` round-trips appended events;
  a non-terminated trailing fragment is dropped; a corrupt terminated
  line throws `StatsError("store_corrupt")`; `appendAuditEvent` on an
  invalid event throws `StatsError("schema_invalid")`; `readAuditEvents`
  with no `sessionId` reads every `.audit.jsonl` under the project;
  absent log → `[]`.
- **Stats dependency graph:** extend
  `packages/stats/test/dependency-graph.test.ts` — the allow-list is
  still exactly `{output-filter, shared, zod}` (no core/context-pruner
  edge added).
- **Core re-export (`packages/core/test/audit-reexport.test.ts`):** the
  four symbols are importable from `@megasaver/core`; a
  `packages/cli`/`mcp-bridge` build never imports `@megasaver/stats`
  directly (existing dependency-graph tests stay green).
- **MCP handler (`audit-token-usage.test.ts`):** happy path (summary
  fields), `window:"session"` requires `sessionId` else
  `validation_failed`; bad `window` → `validation_failed` with the
  `(session | week | all)` hint; unknown project → `resource_not_found`;
  corrupt log → `validation_failed`. **Server e2e:** `ListTools` returns
  **24**; a project seeded (via the store) with `context_pack_built`
  events round-trips an `audit_token_usage` call showing the headline
  numbers.
- **CLI (`audit.test.ts`):** `mega audit report` prints the dashboard
  cards + the `would've been … was … % saved` headline; `--json` emits
  the `AuditSummary`; bad `--window` → clean message + exit 1; `mega
  audit session <id>` resolves and prints; bad session id → clean
  message + exit 1; `mega audit last` picks the newest session; `mega
  audit export --format json` emits JSON and rejects a bad `--format`
  with `(json)` + exit 1. Deterministic via `MEGA_TEST_*` + injected
  `now`. Follow existing CLI test patterns (`tools.test.ts`).

## §11 Decisions / open questions

- **Decided (central):** **(a)** extend `@megasaver/stats` with an
  additive `AuditEvent` family + pure `summarizeAudit` + reader; **no**
  new core `AuditEvent` entity (§6a). Reuses the existing JSONL store,
  atomic-write, error taxonomy, layout, and core re-export path; the
  cycle guard holds because `AuditEvent` is scalar + shared-id only.
- **Decided:** the audit log is a **sibling** `.audit.jsonl` of the byte
  `.events.jsonl`; the byte log is untouched and there is **no duplicate
  token-saver accounting** (§3, §6b).
- **Decided:** **no running summary `.json`** for the audit log — the
  summary is derived on read because it is windowed
  (`session|week|all`); event volume is tiny, so deriving is cheap and
  drift-free (§5).
- **Decided:** Phase 8 **reuses** `estimateSpanTokens` indirectly by
  carrying `PackAudit` integers verbatim; it imports **no** estimator and
  computes **no** token estimate (§2, mandatory constraint).
- **Decided:** **one** read-only MCP tool `audit_token_usage` (23 → 24);
  no `record_audit_event` wire tool — emission stays in the producing
  phases' own wiring, keeping the audited enum tight (§7c, parity with
  Phase 7 §7a).
- **Decided:** CLI surface `mega audit report | last | session | export`;
  roadmap `mega audit`/`audit report` → `report`; roadmap `export
  --format json` honoured literally on `export` and as `--json` on the
  others (§7d).
- **Decided (scope):** this PR ships the full machinery + **one**
  representative emission (`context_pack_built` on the build path) to
  prove the exit demo end-to-end; the other four emissions
  (`rule_applied`/`failure_avoided`/`memory_retrieved`/`tool_route`) are
  declared here and land as focused fast-follows — the summarizer already
  handles all five kinds (§6d, §13).
- **Open (low):** `failure_avoided.retryTokensAvoided` is the producing
  phase's estimate of the avoided retry's output cost; when that phase
  cannot estimate it cheaply, the event records `0` and `retryCostSaved`
  simply does not grow. Whether to later thread a richer estimate is a
  follow-up; **not blocking** (count of avoided failures is still exact).
- **Open (low):** the GUI `TokenSaverStats` view is the obvious future
  home for these cards; wiring it is deferred (§13). Not blocking.

## §12 Out of scope

A real graphical dashboard UI / extending the GUI `TokenSaverStats` view
(GUI is a separate app; this phase's "dashboard" is the CLI text cards +
JSON export); any LLM or new token estimator; re-measuring or
duplicating the byte token-saver accounting; backfilling audit events for
pre-Phase-8 sessions; audit-log retention/rotation; non-JSON export
formats (CSV); a `record_audit_event` MCP tool; the four follow-up
emission call sites beyond the one representative `context_pack_built`
emission (declared in §6d, wired as fast-follows); Phase 9 connectors and
Phase 10 team/cloud audit logs.
