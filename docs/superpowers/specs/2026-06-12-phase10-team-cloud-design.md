---
title: Phase 10 — Team/Cloud — design
risk: HIGH
status: draft
created: 2026-06-12
updated: 2026-06-12
related:
  - docs/superpowers/specs/2026-06-12-phase9-connectors-design.md
  - docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md
  - wiki/syntheses/contextops-roadmap.md
  - wiki/entities/core.md
  - wiki/entities/mcp-bridge.md
  - wiki/entities/connectors-generic-cli.md
---

# Phase 10 — Team/Cloud — design

## §0 TL;DR

Phase 10 is the **final** roadmap phase ("Team/Cloud"). The roadmap
block (wiki/syntheses/contextops-roadmap.md:183-188) describes a full
cloud SaaS: team shared memory, memory permissions, an approval flow,
cloud sync, org rules, audit logs, private deployment, GitHub PR memory
comments, with the exit criterion *"everyone on the team uses the same
project memory."* **Most of that requires servers, auth, hosting, and
secrets — none of which is deterministically testable in this harness,
and all of which violates `mega`'s local-first, no-infra,
single-binary design.** The entire challenge of this phase is **scope
discipline**: build the deterministic local slice that delivers the
roadmap's *governance intent*, and explicitly defer the genuine-cloud
features as a documented future SaaS.

The local slice is the **memory approval workflow** — the headline and
the exit-criterion mechanism:

1. **Schema (`approval`).** `MemoryEntry` gains one closed-enum field
   `approval: "suggested" | "approved" | "rejected"` (declaration order
   = ascending-then-terminal lifecycle, not alphabetic — §3a justifies).
   `backfillMemoryEntry` defaults **every** pre-Phase-10 row to
   `approved` so nothing disappears from existing stores (backward
   compat — critical, there are live Phase 1–9 stores). The
   update-patch schema gains `approval` so `mega memory update` can set
   it (the roadmap "Edit" = update + approve).
2. **Default by author.** An **agent** writing via `save_memory`
   defaults to `suggested` (a machine is proposing). A **human** running
   `mega memory create` defaults to `approved` (a person is asserting
   it). This is the agent-suggests → human-approves flow, done with
   defaults, no UI.
3. **The approval GATE (the exit mechanism).** `suggested` and
   `rejected` memory is **excluded** from everything that shares memory
   with agents or teammates: (a) connector sync (`buildConnectorContext`),
   (b) memory search / relevant-memories / context packs
   (`searchMemoryEntries`), (c) the agent-facing MCP project-context and
   recall tools. Only `approved` memory is shared. A `--all` /
   `includeUnapproved` opt-in surfaces pending suggestions for human
   review. §4 enumerates **every** gated consumer — a missed one leaks
   unapproved memory to agents.
4. **CLI.** `mega memory approve <id>` / `mega memory reject <id>`
   (state transitions); `--all` on `mega memory list` / `mega memory
   search` to review pending.
5. **MCP.** One new tool `approve_memory` (24 → **25**), inserted
   alphabetically (sorts **first**, before `audit_token_usage`). Pending
   review reuses `search_memory` with an `includeUnapproved` arg — no
   second tool (YAGNI).
6. **GitHub PR memory comment (local, deterministic).** A pure markdown
   builder `buildPrMemoryComment(memories, opts)` + a CLI `mega github
   pr-comment <project>` that selects relevant **approved** project
   memory (reusing `searchMemoryEntries` by `--task`/`--files`) and
   prints the comment markdown to **stdout** (deterministic, testable,
   no network). An optional `--post <pr-number>` shells out to `gh pr
   comment` (best-effort thin wrapper; print-only is the default and the
   unit-tested core).
7. **Team-shared memory = a shared STORE, not hosted cloud.** Teammates
   share one project memory by pointing `--store` at a shared / committed
   path; the approval gate governs what is shared. This satisfies the
   roadmap exit *without cloud infra* (§6). Documentation + the gate;
   no new "team" subsystem.

**Decision on `visibility`:** **NOT added.** `approval` alone delivers
the roadmap's permission/approval intent; a `visibility: private|team`
field is speculative (no consumer needs it this phase) and would double
the schema/backfill/gate surface for no behaviour. YAGNI (§3d).

**Out of scope — deferred future SaaS (§8):** hosted cloud sync service,
multi-tenant auth, private deployment, org-wide rule distribution,
hosted audit-log service, a real web approval UI. Each needs
servers/auth/hosting/secrets and is not deterministically testable
here. Listed with a one-line rationale each; **no infra is invented.**

Net-new = one closed-enum field + its backfill default + update-patch +
the gate applied to ~7 consumers + 2 CLI verbs (+ `--all` on 2
commands) + 1 MCP tool + a pure PR-comment builder + 1 CLI command (+ a
thin `gh` wrapper) + the shared-store documentation. **No LLM, no new
package, no server, no auth, no network in the tested path.**

## §1 Motivation & philosophy — governance without infra

Mega Saver's mission (CLAUDE.md §1) is a **local-first ContextOps**
platform; "What we are NOT" explicitly says *"Not a team chatops tool.
Single-developer first."* The roadmap's Phase 10 is the local→SaaS
transition, *"explicitly future per fikri §15.4, out of scope until
Phases 1–9 prove the local product"*
(wiki/syntheses/contextops-roadmap.md:187-188). Phases 1–9 are now
shipped. So Phase 10's job is **not** to build the SaaS — it is to land
the **governance primitive** the SaaS would need anyway, in a form that
works for a single developer today and a shared git-tracked store
tomorrow, with **zero servers**.

The governance primitive is **approval**: a memory item is either a
machine's *suggestion* (untrusted until a human vets it), a human's
*approval* (trusted, shared with agents/teammates), or a *rejection*
(kept for audit, never shared). This is the smallest mechanism that
makes *"everyone on the team uses the same project memory"* meaningful:
without it, any agent's hallucinated "memory" would propagate to every
teammate's `CLAUDE.md` on the next sync. **The gate is the product.**

Governing constraints:

- **Local, deterministic, no infra.** Every IN-scope piece is a pure
  function of (store state, flags) — no clock-dependence beyond the
  existing injected `now`, no network in the tested path, no auth, no
  hosting. The one network touch (`gh pr comment`) is an **optional,
  off-by-default, untested-by-design** wrapper around a builder whose
  output is the deterministic, unit-tested core.
- **Backward compat is non-negotiable.** Existing stores hold typed
  Phase 1–9 rows with **no** `approval` field. They must keep loading
  and nothing may disappear. The backfill defaults them to `approved`
  (§3b) — the only safe default, because those memories were already
  being shared pre-Phase-10 and demoting them to `suggested` would
  silently empty every connector file on the next sync.
- **The gate must be total.** Memory is read by many consumers; the
  approval filter must apply to **every** path that feeds agents or
  teammates. §4 enumerates them exhaustively; §4d marks the paths that
  deliberately do NOT gate (human review surfaces, audit, single-entry
  fetch) and says why.
- **Team = shared store, not a service.** The cheapest thing that makes
  the exit criterion true is two developers pointing at one store dir
  (e.g. committed to the repo). No new code is required for that — the
  `--store` flag already exists; the approval gate makes it *safe*. §6.

## §2 Reconciliation — roadmap SaaS vs the local slice (the central decision)

The roadmap Phase 10 lists eight capabilities. The honest accounting,
capability-by-capability, IN vs OUT, with the rationale that determines
the scope boundary:

### §2a The IN/OUT scope table

| Roadmap capability | Verdict | How (IN) / Why deferred (OUT) |
|--------------------|---------|-------------------------------|
| **Memory approval flow** (agent suggests → Approve / Edit / Reject) | **IN** | `approval` enum + author-defaulting + `mega memory approve`/`reject` + `update` (= Edit) + the gate (§3, §4, §5). The headline. |
| **Memory permissions** | **IN (as approval)** | The only permission Phase 10 needs is "is this memory allowed to be shared with agents/teammates?" — answered by `approval === "approved"` via the gate. A richer ACL (`visibility`, per-user roles) is deferred (§3d, §8). |
| **Team shared memory** | **IN (as shared store)** | Documented pattern: teammates point `--store` at one shared / git-tracked store dir; the approval gate governs what is shared (§6). No hosted service. |
| **GitHub PR memory comments** | **IN (local/deterministic)** | `buildPrMemoryComment` (pure markdown) + `mega github pr-comment` (prints to stdout; `--post` shells to `gh`, best-effort, off by default) (§7). |
| **Cloud sync service** | **OUT** | Needs a hosted server, accounts, conflict resolution, network — not deterministically testable; the shared-store pattern (§6) covers the *intent* locally. (§8) |
| **Multi-tenant auth** | **OUT** | Needs an identity provider, sessions, secrets. No local analogue; nothing to test deterministically. (§8) |
| **Org rules distribution** | **OUT** | Org-wide rule push is a hosted control-plane concern. Project rules already exist locally (Phase 5); cross-org distribution needs a server. (§8) |
| **Hosted audit logs** | **OUT** | A hosted audit-log *service* is infra. The local audit surface already exists (Phase 8 `mega audit` / `audit_token_usage`); approval transitions are observable via `updatedAt` + `mega memory list --all`. A streamed hosted log is deferred. (§8) |
| **Private deployment** | **OUT** | Self-hosting a server is, by definition, deploying a server. No local slice. (§8) |
| **Web approval UI** | **OUT** | A real browser approval UI needs the GUI app + a server round-trip. The CLI `approve`/`reject` + `list --all` is the deterministic local equivalent; the GUI memory route MAY surface `approval` read-only (§4c) but a full review UI is deferred. (§8) |

### §2b The boundary rule (how to classify any future ask)

A capability is **IN** iff it is (a) a pure function of local store
state + flags, (b) deterministically testable with Vitest and no
network, and (c) requires no auth/hosting/secrets. It is **OUT** iff it
needs a server, an account, or a network round-trip to be correct.
Approval, the gate, the shared-store doc, and the PR-comment **builder**
are IN; the `gh` **post** is the single OUT-leaning piece, kept
off-by-default and out of the tested core precisely so the IN/OUT line
stays clean.

### §2c What is reused unchanged vs what is new

- **Reused unchanged:** `MemoryEntry` create/get/list/update/delete
  registry methods (both impls), `searchMemoryEntries` (Core ranker),
  `buildConnectorContext` *structure* (one filter added), the
  `mega memory` command group shape, the MCP server dispatch +
  `TOOL_DEFS` pattern, `resolveProjectAndRoot`, the `--store` flag and
  store resolution, the changeset/wiki discipline.
- **New (additive):** one `approval` enum + `approvalSchema` export; the
  field on `memoryEntrySchema` + `memoryEntryUpdatePatchSchema`; the
  backfill default branch; `source`-aware default in `save_memory` /
  `mega memory create`; the gate filter at every §4 consumer; an
  `includeUnapproved` query field on `MemorySearchQuery`; `mega memory
  approve` / `reject`; `--all` on `list` / `search`; the
  `approve_memory` MCP tool (+ its pin updates); `buildPrMemoryComment`;
  `mega github pr-comment` (+ optional `--post`). **No existing memory
  is dropped or re-typed; the four shipped connector targets sync the
  same approved memory they always did.**

## §3 The schema change — `approval` (the contract)

### §3a The field + its declaration order

`packages/core/src/memory-entry.ts` gains one closed enum, placed with
the other memory enums (after `memorySourceSchema`):

```ts
// Order: lifecycle — a memory is first `suggested` (proposed, usually by
// an agent), then a human moves it to `approved` (shared with agents /
// teammates) or `rejected` (kept for audit, never shared). Declaration
// order is the lifecycle, NOT alphabetic: `approved` is the steady state
// the gate admits and reads most, so it sits in the middle as the hinge.
// AA3 convention: declaration order is a contract — do not reorder.
export const memoryApprovalSchema = z.enum(["suggested", "approved", "rejected"]);
export type MemoryApproval = z.infer<typeof memoryApprovalSchema>;
```

The field is added to `memoryEntrySchema` **with a schema default** so
freshly-constructed entries that omit it are valid and land `approved`
*unless the writer overrides it* (the agent/human default split, §3c,
is applied by the **writer**, not the schema — the schema default of
`approved` is the conservative floor):

```ts
    source: memorySourceSchema,
    approval: memoryApprovalSchema.default("approved"),
    reason: z.string().trim().min(1).optional(),
```

> **Why a schema default of `approved`, not `suggested`?** The schema
> default is the value used when a row/object omits the field entirely —
> which is exactly the **legacy / backfill** case and the **GUI route**
> case (both predate Phase 10 intent). The safe value there is
> `approved` (don't make existing shared memory vanish). The
> *agent-suggests* behaviour is a **writer override** in `save_memory`
> (§3c), not the schema floor. This keeps backfill (§3b) and the schema
> default consistent: both say "an item with no stated approval is
> approved."

### §3b The backfill — the critical backward-compat detail

`backfillMemoryEntry` currently **short-circuits** when `"type" in raw`
(already-typed rows pass through untouched). Existing Phase 1–9 stores
hold typed rows with **no `approval`** — so the existing short-circuit
would return them *without* `approval`, and `memoryEntrySchema` would
then apply its `.default("approved")` on parse. That already yields the
correct value, **but** we make the upgrade **explicit and visible in the
backfill** (so the read-boundary contract is self-documenting and a
future schema change that drops the default can't silently regress).
Add a **separate, independent** approval-defaulting branch that runs
for **any** object row lacking `approval`, regardless of the legacy
`type` check:

```ts
export function backfillMemoryEntry(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  // Phase 10: any row predating the approval field defaults to `approved`
  // so existing shared memory keeps flowing through the gate. This is
  // INDEPENDENT of the legacy-type upgrade below — typed Phase 1–9 rows
  // also lack `approval` and must get it.
  const withApproval =
    "approval" in raw ? raw : { ...(raw as Record<string, unknown>), approval: "approved" };

  if ("type" in withApproval) {
    return withApproval;
  }
  const entry = withApproval as { content?: unknown; createdAt?: unknown };
  if (typeof entry.createdAt !== "string") {
    return withApproval;
  }
  const content = typeof entry.content === "string" ? entry.content : "";
  const title = content.trim().slice(0, LEGACY_TITLE_MAX) || "untitled";
  return {
    ...(withApproval as Record<string, unknown>),
    type: "todo",
    title,
    keywords: [],
    confidence: "low",
    source: "manual",
    stale: false,
    updatedAt: entry.createdAt,
  };
}
```

Two invariants this preserves:

1. **Idempotent.** A row that already has `approval` is returned
   untouched (the `"approval" in raw` guard); a fully-typed Phase-10 row
   passes through unchanged.
2. **Corrupt rows still fail loudly.** The `createdAt`-less corrupt-row
   case is unchanged: it gets `approval` added (harmless) but is still
   returned without fabricated timestamps and still throws on parse
   (§13: no fallbacks for impossible cases). The existing corrupt-row
   test stays green because `toEqual(corrupt)` is replaced by the
   approval-augmented expectation in the same test (§11).

### §3c The author-default split (the agent-suggests flow)

| Writer | File | Default `approval` | Rationale |
|--------|------|--------------------|-----------|
| `save_memory` (MCP, agent) | `packages/mcp-bridge/src/tools/save-memory.ts` | **`suggested`** | A machine is *proposing*; a human must vet it before it's shared. Overridable via the new optional `approval` arg, but the default is `suggested`. |
| `mega memory create` (CLI, human) | `apps/cli/src/commands/memory/create.ts` | **`approved`** | A person at a terminal is *asserting* the memory; it's trusted on creation. (A new `--approval` flag MAY override to `suggested` for a human staging a suggestion, but default is `approved`.) |
| GUI `POST /memory` | `apps/gui/bridge/routes/memory.ts` | **`approved`** (schema default) | Pre-Phase-10 human surface; keep its behaviour (don't silently start hiding GUI-created memory). |

`save_memory` adds `approval: memoryApprovalSchema.optional()` to its
input schema and passes `approval: d.approval ?? "suggested"` into the
constructed entry. `mega memory create` lets the schema default
(`approved`) stand (optionally exposing `--approval`). This is the
entire "agent suggests → human approves" mechanism: **defaults + the
gate**, no workflow engine.

### §3d Decision: `visibility` is NOT added (YAGNI)

The task asks whether to also add `visibility: private | team`. **No.**
Reasoning:

1. **No consumer needs it this phase.** The gate's question is binary —
   *shared or not* — and `approval` answers it. There is no second axis
   ("shared with whom") because team = one shared store (§6); everyone
   on that store sees the same approved set.
2. **It would double the surface for zero behaviour.** `visibility`
   would need its own enum, schema field, backfill default, update-patch
   entry, a second gate dimension at every §4 consumer, CLI flags, and
   pins — all to express a distinction nothing consumes yet.
3. **It is genuinely speculative.** Per-audience visibility only matters
   once there are multiple audiences, i.e. once hosted multi-tenant auth
   exists — which is explicitly OUT (§8). Adding `visibility` now is
   building for the deferred SaaS. CLAUDE.md §13: *no premature
   abstraction; no speculative configurability.*

**Decision: Phase 10 ships `approval` only.** If a future hosted phase
needs `visibility`, it adds it then, against a real consumer.

## §4 The approval GATE — every consumer that must filter to approved-only

This is the load-bearing section: the gate is correct **iff** it is
applied at **every** path that feeds memory to an agent or a teammate.
A missed consumer silently leaks `suggested`/`rejected` memory. The
codebase has **two** ways memory reaches a consumer — through
`searchMemoryEntries` (the ranker) or through `listMemoryEntries` (raw
list) — so the gate is applied in two complementary places.

### §4a Gate point 1 — inside `searchMemoryEntries` (Core ranker)

`packages/core/src/memory-search.ts` is the single chokepoint for all
**ranked / relevance** reads. Add an `includeUnapproved` query field
(default `false`) and filter `approval === "approved"` unless set —
exactly parallel to the existing `includeStale` handling:

```ts
export const memorySearchQuerySchema = z
  .object({
    text: z.string().optional(),
    type: memoryTypeSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    scope: memoryScopeSchema.optional(),
    includeStale: z.boolean().default(false),
    includeUnapproved: z.boolean().default(false),
    limit: z.number().int().positive().default(DEFAULT_LIMIT),
  })
  .strict();
```

```ts
  const filtered = entries.filter(
    (entry) =>
      (q.type === undefined || entry.type === q.type) &&
      (q.confidence === undefined || entry.confidence === q.confidence) &&
      (q.scope === undefined || entry.scope === q.scope) &&
      (q.includeStale || !entry.stale) &&
      (q.includeUnapproved || entry.approval === "approved"),
  );
```

This **single edit** transitively gates **three** consumers that all
route through `searchMemoryEntries`:

| Consumer (via search) | File | Effect |
|-----------------------|------|--------|
| `mega memory search` (CLI) | `apps/cli/src/commands/memory/search.ts` | only approved unless `--all` |
| `search_memory` (MCP) | `packages/mcp-bridge/src/tools/search-memory.ts` | only approved unless `includeUnapproved` |
| `get_relevant_memories` (MCP) | `packages/mcp-bridge/src/tools/get-relevant-memories.ts` | only approved (agent-facing relevance) |
| **context pack** (CLI) | `apps/cli/src/commands/context/shared.ts` | `loadPack` calls `searchMemoryEntries` → `memoryFiles`/`staleFiles` now drawn only from approved memory |

(So the context-pack consumer the task names is gated **for free** by
gate point 1 — it has no separate code change.)

### §4b Gate point 2 — explicit filter on the `listMemoryEntries` consumers

Three agent/teammate-facing consumers bypass the ranker and call
`listMemoryEntries` directly. Each needs an **explicit**
`approval === "approved"` filter (there is no shared chokepoint for raw
lists, by design — raw list is also used by human surfaces that must
NOT gate, §4d):

| Consumer (via list) | File | Required edit |
|---------------------|------|---------------|
| **connector sync** — `buildConnectorContext` | `apps/cli/src/commands/connector/shared.ts` | in `filterMemoryEntriesForSession` (or `buildConnectorContext`), add `entry.approval === "approved"` to the predicate, so only approved memory is rendered into `CLAUDE.md`/`GEMINI.md`/etc. **This is the teammate-facing leak point** — the whole exit criterion. |
| **GUI connector mirror** — `buildConnectorContext` | `apps/gui/bridge/connector-context.ts` | same filter (the file's comment says it mirrors the CLI builder; keep them identical). |
| **`get_project_context`** (MCP, agent briefing) | `packages/mcp-bridge/src/tools/project-context.ts` | add `&& m.approval === "approved"` to the `keyMemories` filter (it already filters `!m.stale && confidence !== "low"`). |
| **`mega_recall`** (MCP, session recall) | `packages/mcp-bridge/src/tools/recall.ts` | add `&& m.approval === "approved"` to the `allMemory.filter(...)` predicate. |

> **Why connector sync gates via `buildConnectorContext`, not the
> ranker:** connector sync renders the **most-recent project + session
> memory** (capped at 20), not a relevance-ranked set — it calls
> `listMemoryEntries` then `buildConnectorContext`, never
> `searchMemoryEntries`. So its gate must live in the builder. This is
> the single most important gate point: it is what teammates see in
> their committed agent files.

### §4c The full gated-consumer list (the checklist — none may be missed)

1. `searchMemoryEntries` (Core) — **chokepoint** (gate point 1), which covers:
   1a. `mega memory search` (CLI)
   1b. `search_memory` (MCP)
   1c. `get_relevant_memories` (MCP)
   1d. context pack `loadPack` (CLI `mega context` / `mega pack`)
2. `buildConnectorContext` (CLI connector sync/status/doctor) — explicit filter (gate point 2)
3. `buildConnectorContext` (GUI bridge mirror) — explicit filter (gate point 2)
4. `get_project_context` (MCP) — explicit filter (gate point 2)
5. `mega_recall` (MCP) — explicit filter (gate point 2)

**Five consumer surfaces, two of which (1, the chokepoint) fan out to
four sub-consumers.** Connector **status** and **doctor**
(`apps/cli/src/commands/connector/status.ts`, `doctor.ts`) call
`buildConnectorContext` too, so they inherit the gate from (2)
automatically — their drift/`ok`/`stale` verdicts are computed against
the **approved** set, which is correct: an agent file is "in sync" iff
it matches the approved memory it would be synced with.

### §4d Paths that deliberately do NOT gate (and why)

A correct gate is as much about what it **excludes** as includes.
These read memory but MUST show the unapproved set:

| Non-gated path | File | Why it must NOT gate |
|----------------|------|----------------------|
| `mega memory list` (default) | `apps/cli/src/commands/memory/list.ts` | A human's full inventory of their own project memory. **Gains `--all`** semantics differently: see §5c — `list` shows everything by default (it's the management surface) but renders the `approval` column so pending items are visible; it is NOT an agent-sharing path. |
| `mega memory approve`/`reject` review | new commands | They operate **on** suggested/rejected items — gating them out would make them unreachable. |
| `getMemoryEntry` (single fetch) | both registries | Fetching one entry by id (e.g. before `approve`/`update`/`delete`) must return it whatever its approval, or the verbs can't act on suggestions. |
| `listMemoryEntries` (raw) | both registries | The primitive itself stays un-gated; gating is the **caller's** decision (agent-facing callers gate per §4b; human surfaces don't). This keeps the registry honest — it returns what's stored. |
| GUI `GET /memory` | `apps/gui/bridge/routes/memory.ts` | The GUI memory **management** view should show all entries (it MAY add an `approval` column read-only, §4c-OUT note); it is not a connector-sync path, so it does not leak to agents. |
| Phase 8 audit (`mega audit`) | audit surfaces | Audit must see everything, including rejected, by definition. |

The rule: **gate every path whose output is handed to an agent or
written into a teammate's file; never gate a human's own management /
review / audit surface.**

## §5 CLI surface

### §5a `mega memory approve <id>` / `mega memory reject <id>`

Two new subcommands of the `memory` group
(`apps/cli/src/commands/memory/index.ts`), each a thin
`run<Name>(input): Promise<0 | 1>` core + a citty wrapper, mirroring
`mega memory update` (they are a constrained update: set `approval` +
`updatedAt`).

- `mega memory approve <id> [--store] [--json]` → loads the entry
  (not-found → the canonical `memoryEntryNotFoundMessage`, exit 1),
  calls `registry.updateMemoryEntry(id, { approval: "approved",
  updatedAt })`, prints the id (or JSON). **Idempotent** — approving an
  already-approved entry is a no-op success (sets approval to the same
  value; no error, parity with how `update` re-setting a field works).
- `mega memory reject <id> [--store] [--json]` → same, `approval:
  "rejected"`. A rejected entry stays in the store (audit) but is gated
  out of all agent/teammate paths (§4).
- The roadmap **"Edit"** action = the existing `mega memory update`
  (change content/title/etc.) **followed by** `mega memory approve`
  (which the human runs once they're happy). No new "edit" verb — update
  already exists and now `approval` is one of its patchable fields (§3,
  update-patch).

`updateMemoryEntry` already accepts a patch with `updatedAt`; adding
`approval` to `memoryEntryUpdatePatchSchema` (§3) is what lets these
verbs (and `mega memory update --approval`) work without touching the
registry.

### §5b `--all` on `mega memory search`

`mega memory search` gains `--all` → passes `includeUnapproved: true`
into the search query, so a human can review pending suggestions by
relevance. Default (no flag) returns approved only (gate point 1). The
existing `--include-stale` flag (if present) is the precedent for the
flag shape; `--all` is the approval analogue.

### §5c `mega memory list` and the `approval` column

`mega memory list` is the **management inventory** (§4d) — it shows
**all** entries regardless of approval (a human managing their store
must see suggestions). To make approval visible, `formatMemoryListLine`
(`apps/cli/src/commands/memory/shared.ts`) gains an `approval` column,
and `formatMemoryExplainLines` gains an `approval` row (so `mega memory
explain` shows it). The `--json` output already serialises the whole
entry, so `approval` appears there automatically once the schema has it.
(No `--all` on `list` — it already lists all; `--all` belongs on
`search`, the relevance/agent-shaped surface.)

### §5d `mega github pr-comment <project>` (§7 details the builder)

A new top-level command group `mega github` with one subcommand
`pr-comment`, registered in `apps/cli/src/main.ts` alongside the other
groups. (Chosen over `mega pr memories` to leave room for future
`github` subcommands and to name the integration after the platform.)

```
mega github pr-comment <project> [--task <str>] [--files <path>...]
  [--limit <n>] [--post <pr-number>] [--store <dir>] [--json]
```

- Resolves the project (reuse `resolveProjectAndRoot` /
  `loadProjectContext`), selects **approved** project memory relevant to
  `--task` / `--files` via `searchMemoryEntries` (gate point 1 ensures
  approved-only — suggested memory never reaches a PR comment), builds
  the markdown via `buildPrMemoryComment`, and **prints it to stdout**
  (deterministic, network-free — the default).
- `--post <pr-number>` (optional): shells out to `gh pr comment
  <pr-number> --body-file -` (or `--body`), piping the built markdown.
  Best-effort: if `gh` is absent or fails, emit a clear stderr line +
  exit 1; **this path is not unit-tested** (it's a thin wrapper over an
  external binary + network). The print-only path is the tested core.
- Exit `0` on successful build/print; `1` on project-not-found / `gh`
  failure (when `--post`).

## §6 Team-shared memory = a shared store (the exit-criterion reconciliation)

The roadmap exit is *"everyone on the team uses the same project
memory."* The local, infra-free realisation:

- **Mechanism:** all teammates run `mega` against **one shared store
  directory** — e.g. a `--store ./​.megasaver` committed to the repo, or
  a shared network/synced path. The store is the existing
  JSON-directory store; nothing new is built. The `--store` flag and
  `MEGA_STORE` env already select it (store resolution exists).
- **Why approval makes this safe (and is the actual Phase 10 work):**
  with a shared store, **any agent on any teammate's machine** can write
  memory via `save_memory`. Without the gate, those writes default-share
  to **everyone's** `CLAUDE.md` on the next `mega connector sync` —
  including hallucinations. **The approval gate is what makes a shared
  store trustworthy:** agent writes land `suggested` (invisible to
  everyone until vetted); a human runs `mega memory approve` once; only
  then does the memory flow into every teammate's agent files. *That* is
  "everyone uses the same project memory" — the same **approved** set,
  governed.
- **No helper command needed.** `mega store path` / a `team` subcommand
  is not warranted (YAGNI) — pointing `--store` at a shared path is
  documentation, not code. The spec/README documents the pattern; the
  gate is the code. (If the implementer finds an existing `mega store`
  group trivial to extend with a `path` echo, it's optional polish, not
  required.)
- **Proof (test):** an integration test seeds a store, has an "agent"
  write (`save_memory` → `suggested`), asserts a `mega connector sync`
  renders **nothing** for it (gated out), then `mega memory approve`s
  it, re-syncs, and asserts **both** a claude-code and a cursor file now
  contain it — the same approved memory in two agents' files from one
  shared store. This is the Phase 9 cross-agent proof **plus** the
  approval gate: the executable exit criterion (§11).

## §7 GitHub PR memory comment — local & deterministic

### §7a `buildPrMemoryComment(memories, opts)` — the pure, tested core

A pure function (new file, `packages/core/src/pr-memory-comment.ts`,
exported from `@megasaver/core`) that renders a list of memory entries
into a Markdown comment body. No I/O, no clock, no network — a string
in, a string out.

```ts
export type PrMemoryCommentOptions = {
  projectName: string;
  task?: string;
  heading?: string; // default "Mega Saver — relevant project memory"
};

export function buildPrMemoryComment(
  memories: readonly MemoryEntry[],
  opts: PrMemoryCommentOptions,
): string;
```

- Renders a stable heading, an optional task line, then one bullet per
  memory: `- **<type>** (<confidence>): <title>` with the `content`
  and, when present, `relatedFiles` as an indented sub-line. Order is
  the input order (caller passes the already-ranked approved set), so
  output is a deterministic function of input.
- **Empty case:** when `memories` is empty, render a single explicit
  line ("No relevant approved project memory.") rather than an empty
  comment — so the command's output is always well-formed and testable.
- **Approval assumption:** the builder does NOT filter — it renders what
  it's given. The **caller** (`mega github pr-comment`) passes only
  approved memory (gate point 1). The builder is dumb on purpose
  (single responsibility; unit-testable in isolation).
- Markdown is escaped where a memory field could contain `|`/backticks
  that would break rendering (defensive at the rendering boundary, which
  is a real downstream-corruption risk — parity with the connector
  block's content handling).

### §7b `--post` — the thin, off-by-default `gh` wrapper

A small helper that spawns `gh pr comment <n> --body-file -` and pipes
the built markdown. It is **best-effort and untested by design**:
network + external binary. Default behaviour is print-only, so the
whole feature is deterministic and CI-safe; `--post` is opt-in
convenience. A `gh`-not-found or non-zero exit produces a mapped stderr
line and exit 1 — no silent failure.

## §8 Out of scope — deferred future SaaS (explicit, with rationale)

Each is a documented follow-up; **no infra is invented here.**

- **Hosted cloud sync service.** Needs a server, accounts, and conflict
  resolution over the network — not deterministically testable; the
  shared-store pattern (§6) delivers the local intent. *Deferred.*
- **Multi-tenant auth.** Needs an identity provider, sessions, and
  secret management; no local analogue. *Deferred.*
- **Private / self-hosted deployment.** Is, by definition, running a
  server; there is no local slice. *Deferred.*
- **Org-wide rule distribution.** A hosted control-plane pushing rules
  across orgs; local project rules already exist (Phase 5), but
  cross-org push needs a server. *Deferred.*
- **Hosted audit-log service.** A streamed/hosted audit log is infra;
  the local audit surface (Phase 8) + approval `updatedAt` already give
  a local trail. *Deferred.*
- **Web approval UI.** A browser review/approve UI needs the GUI + a
  server round-trip; the CLI `approve`/`reject` + `list`/`search --all`
  is the deterministic local equivalent. (The GUI MAY surface the
  `approval` field read-only — that's a thin, optional follow-up, not a
  review workflow.) *Deferred.*
- **`visibility` / richer per-audience permissions.** Speculative until
  multi-tenant auth exists (§3d). *Deferred.*
- **`approve_memory` for non-agent bulk ops / a `reject_memory` MCP
  tool.** One `approve_memory` tool covers the agent-facing need
  (an agent that realises a suggestion is good can approve it — or, more
  conservatively, this could be human-only; see §12 open question).
  Bulk/reject MCP tooling is deferred unless a consumer appears.

## §9 The MCP tool change — `approve_memory` (24 → 25)

### §9a The new tool

One tool, `approve_memory`, added to `mcpToolNameSchema`
(`packages/mcp-bridge/src/tool-name.ts`) **alphabetically** — it sorts
**first** (`approve_` < `audit_`), so it is inserted before
`audit_token_usage`. Handler (`packages/mcp-bridge/src/tools/approve-memory.ts`):

```ts
const approveMemoryInputSchema = z
  .object({
    memoryEntryId: z.string().min(1),
    approval: memoryApprovalSchema.default("approved"),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
```

It calls `registry.updateMemoryEntry(id, { approval, updatedAt: now })`
(now injected, parity with `save_memory`), maps `memory_entry_not_found`
→ `resource_not_found`, returns `{ id, approval }`. Wired into
`server.ts`: a `TOOL_DEFS` entry (`{ name: "approve_memory",
description: "Approve or reject a suggested memory entry." }`) and a
`case "approve_memory":` dispatch arm.

### §9b The pins (the closed-enum drift guards — hand-updated)

The MCP tool enum is pinned in **three** places that must move in
lockstep (the AA1 §17 / closed-enum-tripwire discipline):

| Pin | File | Edit |
|-----|------|------|
| runtime tuple | `packages/mcp-bridge/test/tool-name-task.test.ts` | add `"approve_memory"` **first** in the expected `.options` array; bump "24 tools" → "25 tools" (describe + assertion) |
| type-level tuple | `packages/mcp-bridge/test/tool-name.test-d.ts` | add `"approve_memory"` first in the `members` array and the ordered `readonly [...]` tuple; bump the "24-member" comment to 25 |
| other tool-name tests | `tool-name-forge.test.ts`, `tool-name-phase4.test.ts` | these read `mcpToolNameSchema.options` for membership checks; verify they don't pin a count that breaks (audit + extend if they assert length) |

`approve_memory` is a **new** tool name, but it is **not** a new closed
enum (it's a member of the existing `McpToolName` enum), so the
`enum-pin-audit.test.ts` "exactly 8 epic enums" count (`apps/cli`) is
**unchanged** — no new pin file is added, only the existing
`McpToolName` pins are extended. §11 lists the exact test edits.

## §10 Determinism, purity & risk

### §10a Determinism

- `approval` is a closed enum; the gate is a pure predicate; the
  backfill is a pure, idempotent transform. No clock beyond the existing
  injected `now` (used only to stamp `updatedAt` on approve/reject).
- `buildPrMemoryComment` is a pure string function — fully unit-testable.
- The only non-deterministic/network path is `mega github pr-comment
  --post` (the `gh` shell-out), which is **off by default and outside
  the tested core** (§7b). Everything in `pnpm verify` is deterministic.

### §10b Risk — HIGH

Per CLAUDE.md §12: a **memory schema change** + **public CLI flags** +
**connector core path** (the sync gate writes user files) is HIGH (pulls
in `critic` adversarial review). The dominant risks:

1. **A missed gate consumer leaks unapproved memory to agents/teammates
   (the CRITICAL failure mode).** Mitigated by §4's exhaustive
   enumeration (two gate points covering five surfaces) + a test per
   gate point asserting `suggested`/`rejected` memory is absent from
   each output (connector file, `search_memory`, `get_relevant_memories`,
   `get_project_context`, `mega_recall`, context pack). The
   shared-store proof (§6) is the end-to-end guard.
2. **Backfill drops or mis-defaults existing memory (silent data loss).**
   Mitigated by the explicit independent approval branch (§3b), the
   idempotency + corrupt-row tests, and a store-fixture test that loads
   a pre-Phase-10 JSONL and asserts every row reads back `approved`.
3. **The two registry impls drift** (in-memory vs json-directory).
   `approval` lives in `memoryEntrySchema`, which both impls parse on
   every read/write — so neither impl needs bespoke approval logic; the
   schema carries it. A symmetry test (existing pattern) asserts both
   round-trip `approval` identically.
4. **Stale MCP-tool-enum pin** (the recurring closed-enum regression).
   Mitigated by §9b's three lockstep pin edits + `critic`'s closed-enum
   sweep.
5. **`--post` shelling to `gh` does something destructive / leaks.**
   Mitigated by it being off-by-default, print-only core, and never
   running in tests; the built markdown is the only thing piped, to a
   user-named PR.

## §11 Testing (TDD — tests first)

- **Schema (`packages/core/test/memory-entry.test.ts`):** `approval`
  accepts the three members; defaults to `approved` when omitted;
  rejects an unknown value; update-patch accepts `approval`. **Backfill:**
  (a) a typed Phase 1–9 row **without** `approval` reads back `approved`;
  (b) a legacy v0.1 row (no `type`) gets both the type upgrade **and**
  `approval: "approved"`; (c) idempotent on an already-`approved` row;
  (d) the corrupt (no-`createdAt`) row gets `approval` added but still
  throws on parse — the existing corrupt test is updated to the
  approval-augmented expectation.
- **Gate point 1 (`packages/core/test/memory-search.test.ts`):**
  `searchMemoryEntries` excludes `suggested`/`rejected` by default;
  `includeUnapproved: true` includes them; interaction with
  `includeStale` is independent (a suggested-stale entry needs both
  flags).
- **Gate point 2 — connector (`apps/cli/test/connector*.test.ts`):**
  a `suggested` project memory is NOT rendered into any target file;
  after `approve`, it IS. GUI mirror (`apps/gui` bridge test) same.
- **Gate point 2 — MCP (`packages/mcp-bridge/test/...`):**
  `get_project_context` `keyMemories` and `mega_recall` `memory` exclude
  unapproved; `search_memory` / `get_relevant_memories` exclude
  unapproved (no `includeUnapproved`) and include with it.
- **Author defaults:** `save_memory` (no `approval`) → entry reads
  `suggested`; `mega memory create` (no flag) → `approved`; GUI POST →
  `approved`.
- **CLI verbs (`apps/cli/test/memory*.test.ts`):** `approve` sets
  `approved` (+ idempotent); `reject` sets `rejected`; not-found → exit
  1; `--json` shape; `list` shows the `approval` column for all entries;
  `search --all` includes suggestions; `explain` shows the `approval`
  row.
- **PR comment (`packages/core/test/pr-memory-comment.test.ts`):**
  deterministic markdown for a fixed memory list; empty-list line;
  field escaping; (CLI `apps/cli/test/github-pr-comment.test.ts`)
  `mega github pr-comment` prints the comment from **approved** memory
  only, exit 0; project-not-found exit 1; `--post` is NOT exercised
  (documented as the untested wrapper).
- **MCP tool enum pins (`tool-name*.ts`):** `approve_memory` present,
  first, count 24 → 25 (runtime + type-level); `approve_memory` handler
  approves/rejects, not-found → `resource_not_found`.
- **Shared-store exit proof (`apps/cli/test/team-shared-memory.test.ts`,
  new):** agent `save_memory` (suggested) → sync renders nothing →
  `approve` → re-sync → both claude-code + cursor files contain it (§6).
- **Symmetry (`packages/core/test/registry-parity...`):** both registry
  impls round-trip `approval` identically.

## §12 Decisions / open questions

- **Decided (central):** Phase 10 ships the **local approval slice**;
  hosted cloud sync / auth / private deploy / org rules / hosted audit /
  web approval UI are **deferred** (§2a, §8). No infra invented.
- **Decided:** add **`approval`** only; **no `visibility`** (YAGNI,
  §3d).
- **Decided:** `approval` enum order is **lifecycle**
  (`suggested, approved, rejected`), not alphabetic (§3a) — documented
  as a deliberate declaration-order contract.
- **Decided:** backfill default = **`approved`** (the only safe value
  for already-shared legacy memory), via an **independent** branch that
  runs for any row lacking `approval` (§3b).
- **Decided:** author defaults — `save_memory`(agent) → `suggested`;
  `mega memory create`(human) + GUI POST → `approved` (§3c).
- **Decided:** the gate lives at **two points** — inside
  `searchMemoryEntries` (covers search/relevant/context-pack) and as an
  explicit filter on the four `listMemoryEntries` consumers (connector
  ×2, project-context, recall) (§4).
- **Decided:** **one** new MCP tool `approve_memory` (24 → 25,
  alphabetical-first); reuse `search_memory --includeUnapproved` for
  listing pending — no `list_pending_memories` tool (§9, YAGNI).
- **Decided:** CLI — `mega memory approve|reject`, `--all` on `search`,
  `approval` column on `list`/`explain`, `mega github pr-comment`
  (+ optional `--post`) (§5).
- **Decided:** team = **shared store** + the gate; documentation, not a
  `team` subsystem (§6).
- **Open (low, non-blocking):** should `approve_memory` (MCP, agent-
  callable) allow an **agent** to approve, or be human-only? Default
  here: the tool exists and approves, but the **safer** product stance
  is that approval is a human act — if the implementer/`critic` prefers,
  restrict `approve_memory` to set only `rejected`/leave-suggested and
  keep `approved` a human-CLI-only transition. Isolated to the tool's
  input schema; does not affect the gate or the schema. Flagged rather
  than silently chosen.
- **Open (low):** `mega github` group name vs `mega pr` — chose
  `mega github pr-comment` for namespacing; trivial to rename, no
  ripple beyond `main.ts` registration.

## §13 Self-review

- **Explicit §Scope IN/OUT table?** §2a (capability-by-capability IN/OUT
  with rationale) + §2b (the boundary rule). ✓
- **Approval-gate consumer list complete?** §4 — gate point 1 (the
  `searchMemoryEntries` chokepoint → 4 sub-consumers) + gate point 2
  (4 explicit `listMemoryEntries` consumers) + §4c checklist + §4d the
  deliberately-non-gated paths. Cross-checked against the repo-wide
  `searchMemoryEntries`/`listMemoryEntries` grep. ✓
- **Team = shared store reconciliation?** §6 (mechanism + why approval
  makes it safe + the exit proof + no new subsystem). ✓
- **Deferred-cloud list with one-line rationale each?** §8 (seven
  deferrals, no infra invented). ✓
- **Schema + backfill default specified, backward compat safe?** §3a
  (field + order), §3b (independent approval branch, idempotent,
  corrupt-row safe), §3c (author defaults). Default = `approved`. ✓
- **`visibility` decision stated?** §3d — NOT added, YAGNI, with
  reasoning. ✓
- **MCP tool count + alphabetic placement?** §9 — `approve_memory`,
  24 → 25, sorts first; three lockstep pin edits; no new closed-enum
  pin file. ✓
- **PR-comment approach (pure builder + optional `gh`)?** §7a (pure,
  tested, escaping, empty case) + §7b (off-by-default `gh` wrapper,
  untested core). ✓
- **No LLM / no new package required / deterministic tested path?** §0,
  §10 (the only network is off-by-default `--post`). PR builder lives in
  `@megasaver/core`; no new package. ✓
- **Risk classified + mitigations?** §10b (HIGH, five risks, the
  leak-a-consumer + backfill-data-loss ones front-and-centre). ✓
- **Open questions flagged, not guessed?** §12 — agent-vs-human approve,
  `github` group name; both low, isolated, non-blocking. ✓
