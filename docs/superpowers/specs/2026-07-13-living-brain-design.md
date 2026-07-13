# Living Brain (i1) — Design Spec

- **Date:** 2026-07-13
- **Status:** approved-pending-architect-pass
- **Risk:** HIGH (§12 — memory schema change + main write path). Worktree,
  architect pass before implementation, `code-reviewer` AND `critic`
  gauntlet, verifier evidence.
- **Source idea:** `wiki/syntheses/memory-moat-sketches.md` §i1 (score 28.3),
  scope + gating locked by user 2026-07-13 (full sketch; existing
  `savings-analytics` entitlement key).
- **Entitlement:** write path all FREE; `mega memory history` and
  `--as-of` PRO.

## 1. Problem

The bi-temporal schema (M1: `validFrom` / `validTo` / `supersedesId`) is
write-orphaned. Only one path closes a superseded row's validity —
`approve_memory` with an *explicitly* agent-supplied `supersedesId` — and
even that path is mostly unreachable (see §3.1). Nothing detects
supersession at save time, nothing deduplicates the main write path,
nothing reads lineage back, and no CLI can query valid-time history.
Meanwhile ranking decay keys on `updatedAt`, so an approve/reject/sweep
resets a memory's age.

Goal: every memory write detects conflict with the live corpus, links
lineage, closes stale validity at the human-approval boundary, and the
recall surfaces + CLI expose the resulting history. "Git log for
decisions," local-first, cross-agent.

## 2. Grounding (verified on `feat/guard` worktree, 2026-07-13)

Facts the design builds on — all verified by direct read:

- `memoryEntrySchema` (`packages/core/src/memory-entry.ts:76-127`):
  `validFrom?`, `validTo?` (nullable), `supersedesId?` present.
  `validTo` **is** patchable; `validFrom`/`supersedesId` immutable after
  create (`memoryEntryUpdatePatchSchema`, lines 310-335, `.strict()`).
  `evidence` is a **plain `string[]`** — no object shape.
  `lastActiveAt` does not exist anywhere yet.
- `isCurrent` half-open `[validFrom, validTo)` (lines 136-143);
  `isRecallable` = approved + current + non-archival (lines 165-175) —
  documented as the single shared gate for all recall surfaces.
- `effectiveConfidence` (lines 205-215) keys decay on
  `updatedAt ?? createdAt`, 30-day half-life.
- `checkConflicts(candidate, approvedActive)`
  (`packages/core/src/conflict-checker.ts:26`): precedence-ordered
  `duplicate` (norm title+content equal) → `supersession` (same type +
  relatedFiles overlap + different content) → `contradiction`
  (project_rule + file overlap + negation-keyword XOR on `keywords`) →
  `unrelated`. Single-element `conflictIds`.
- `approve-memory.ts:177-201` closes `validTo` on approve when the flipped
  row carries `supersedesId`, guarded: target exists, non-self,
  same-project, same-scope, `validTo == null`. Silently skipped otherwise;
  never reported in the tool response.
- **Quarantine gate** `approve-memory.ts:156-172`: `conflict.outcome !==
  "unrelated"` blocks the approve flip (row stays `suggested`);
  `duplicate` flips to `rejected`.
- Core search already supports valid-time queries: `asOf` on
  `memorySearchQuerySchema` (`memory-search.ts:31`) and the semantic
  variant; search filters by `isCurrent(entry, asOf)` and weights BM25 by
  `effectiveConfidence`. **No CLI flag exposes it.**
- Embeddings: `@megasaver/embeddings` `cosine`/`embed`/`readVectors`;
  sidecar `<store>/memory/<projectId>.embeddings.jsonl`, built ONLY by
  `mega memory index` / MCP `index_memory`. `embed()` lazy-loads a ~50MB
  optional dep. `get-relevant-memories` uses all-or-nothing semantic
  fallback, not score fusion.
- Writers that call `registry.createMemoryEntry` today (none runs
  `checkConflicts`):
  1. `apps/cli/src/commands/memory/create.ts` — born `approved`.
  2. `packages/mcp-bridge/src/tools/save-memory.ts` — default
     `suggested`; `supersedesId` passthrough exists.
  3. `apps/cli/src/commands/memory/from-session.ts` — `suggested`,
     own `from-session:<key>` dedupe.
  4. `packages/mcp-bridge/src/tools/from-session-memory.ts` — twin of 3.
  5. `apps/cli/src/commands/task/status.ts` `--save-summary` — born
     `approved` via schema default.
  6. `packages/core/src/brain-import.ts` — deliberately strips
     `supersedesId`; **stays on raw `createMemoryEntry`** (imports must
     not auto-close anything cross-machine).
- Recall surfaces are **four**, not three: `get_relevant_memories`,
  `mega_recall` (unranked, returns all recallable; enrich in the
  `inProcess` closure), connector context block
  (`buildConnectorContext` + `packages/connectors/shared/src/render.ts`
  `renderMemoryEntries`), and the warm-start brief
  (`packages/core/src/warm-start.ts` memLine, greedy budget).
- Connector selection (`filterMemoryEntriesForSession`,
  `apps/cli/src/commands/connector/shared.ts:35`) checks approval + scope
  only — closed predecessors still render today.
- Entitlement: `ProFeature = "savings-analytics" | "brain-portability"`;
  `checkEntitlement` ignores the feature param (key is documentation).
  Canonical gate-first + sentence-style upsell + exit 0 pattern
  (`guard/events.ts:26-34`, `savings/shared.ts:14-15`).
- `mega memory explain` prints two sequential section loops
  (`explain.ts:62-64`); `formatMemoryExplainLines` omits
  `validFrom`/`validTo`/`supersedesId` — a lineage section is additive.
- `updateMemoryEntry` mutates in place; no reopen/undo exists.

## 3. Design corrections vs. the sketch

### 3.1 Declared-target exemption (the critical one)

The sketch's invariant — "validTo closes exactly when a superseding row
becomes approved" — collides with the existing quarantine gate: if
create-time detection links `supersedesId` on an agent write, then at
approval `checkConflicts` classifies the same pair `supersession` again
and **blocks the flip**, so the close never runs. The auto-supersede loop
would be dead on arrival for every `suggested` write.

Fix — a narrow exemption in `approve-memory.ts`:

> Allow the approve flip when `conflict.outcome` is `"supersession"` or
> `"contradiction"` AND `conflict.conflictIds` is exactly the one entry
> named by `existing.supersedesId`. The conflict is *declared* — the
> candidate exists to supersede that row; approval resolves it via the
> validTo close.

`duplicate` still auto-rejects. Conflicts with any *other* entry (not the
declared target) stay quarantined exactly as today. Evidence validation
(fail-closed sidecar checks) is untouched and still runs first.

### 3.2 Five writers, not three

§2 list. `saveMemoryWithLineage` rewires writers 1-5; `brain-import`
excluded by design (documented why in code).

### 3.3 Connector validity leak

`filterMemoryEntriesForSession` gains the shared `isRecallable(entry,
now)` gate (replacing the bare `approval === "approved"` check). This is
a deliberate behavior change: closed (superseded) and archival-tier rows
stop rendering in the connector Memory block. Without it a `changedFrom`
line would co-render beside the very predecessor it references.

## 4. Architecture

### 4.1 MOVE 1 — `packages/core/src/supersession.ts` (new)

All named constants live here (single tunable site):
`SUPERSEDE_TOP_K = 5`, `SUPERSEDE_COSINE_LINK = 0.80`,
`SUPERSEDE_COSINE_AMBIGUOUS = 0.60`,
`POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:"`.

**`applySupersession(registry, entry, now): { closed: boolean }`**
The validTo-close block lifted verbatim from `approve-memory.ts:177-201`
(target validation included). Callers: the approve flip (existing,
rewired — pure refactor, existing tests must stay green) and
`saveMemoryWithLineage` when the new entry is born `approved`.

**`detectSupersession(candidate, corpus, opts?): SupersessionDetection`**
Pure given inputs; no I/O. `opts?: { queryVector?: Float32Array;
memoryVectors?: Map<string, Float32Array> }` — embedding is the caller's
async boundary, mirroring `searchMemoryEntriesSemantic`.

- Eligible corpus (caller pre-filters, helper provided):
  same `projectId`, same `type`, `approval === "approved"`,
  `isRecallable(now)`, scope-compatible (`project`↔`project`;
  `session`↔same `sessionId`), `id !== candidate.id`.
- Decision ladder (deterministic, first match wins):
  1. `checkConflicts` `duplicate` ⇒ `{ kind: "duplicate", existingId }`.
  2. `checkConflicts` `supersession` | `contradiction` ⇒
     `{ kind: "supersede", supersededId: conflictIds[0],
        method: "lexical" }`.
  3. Cosine overlay — only when `opts.queryVector` AND the BM25 top-1
     (via existing `searchMemoryEntries` over the corpus subset,
     `limit: SUPERSEDE_TOP_K`) has a sidecar vector:
     `cosine ≥ 0.80` ⇒ `{ kind: "supersede", supersededId: top1.id,
     method: "cosine", score }`; `0.60 ≤ cosine < 0.80` ⇒
     `{ kind: "ambiguous", possibleIds }` — no link; caller appends
     `"possible-supersedes:<id>"` strings to the entry's `evidence[]`
     (plain-string format per §2).
  4. Otherwise `{ kind: "none" }`.
- **No BM25-only auto-link.** BM25 scores are unnormalized; the 0.60/0.80
  bands are cosine bands. Lexical linking happens only through
  `checkConflicts`' semantic classes. Result carries
  `method: "lexical" | "cosine"` so degraded quality is visible.
- LLM-confirm pass: **cut from v1** entirely.

**`buildLineage(entries, id): LineageChain`**
Backward walk via `supersedesId`; forward children via one linear scan
building a `supersedesId → child[]` map. No new index, no back-pointer
field. Cycle-guarded (visited set — `supersedesId` is agent-controlled
data; malformed chains must not hang the CLI).

### 4.2 MOVE 2 — `saveMemoryWithLineage` + writer rewire

```ts
saveMemoryWithLineage(registry, entry: MemoryEntry, opts: {
  now: () => string;
  detect?: boolean;              // default true; false = --no-supersede
  queryVector?: Float32Array;    // optional cosine overlay inputs
  memoryVectors?: Map<string, Float32Array>;
}): {
  entry: MemoryEntry;            // the written (or existing, if deduped) row
  supersession?: { supersededId: string; method: "lexical" | "cosine"; score?: number };
  deduped?: { existingId: string };
}
```

Flow: explicit `entry.supersedesId` beats detection (skip detect) →
otherwise `detectSupersession` → `duplicate` short-circuits (no write,
return existing) → `supersede` sets `supersedesId` on the entry at create
(immutable field, so it must land here) → `ambiguous` appends evidence
strings → `createMemoryEntry` → if the created row is `approved`,
`applySupersession` immediately. `suggested` rows carry the link but
close nothing — the close fires at approval via the existing gate + §3.1
exemption. **The human-approval boundary is preserved: agent writes never
auto-close anything at save time.**

Rewired writers (1-5 of §2). Surface contracts:

- `mega memory create`: stdout stays a single id line (script contract);
  notes go to **stderr**: `note: superseded a1b2c3 ("use npm for
  installs")` / `note: duplicate of a1b2c3 — not written` (dedupe still
  prints the existing id on stdout). `--json` gains `supersession?` /
  `deduped?`. New flag `--no-supersede` ⇒ `detect: false`.
- MCP `save_memory` response: `{ id }` → `{ id, supersession?, deduped? }`
  (additive). Explicit `supersedesId` passthrough unchanged.
- from-session twins: keep their `from-session:` dedupe key; detection on.
- `task status --save-summary`: detection on (born-approved ⇒ immediate
  close possible).
- Cosine overlay wiring in production: `save_memory` env gains optional
  `embedFn` (same pattern as `approve-memory`); the handler embeds the
  candidate text once, best-effort try/catch → on any failure falls back
  to lexical-only. CLI create stays lexical-only in v1 (no model load on
  an interactive command).

### 4.3 MOVE 3a — decay rekey (`lastActiveAt`)

- Schema: optional `lastActiveAt: z.string().datetime({offset:true})` on
  `memoryEntrySchema`, `overlayMemoryEntrySchema`, and the update patch
  schema (patchable).
- Set: at create (= `createdAt`); by `mega memory update` when the patch
  touches content-bearing fields (`title`/`content`/`keywords`/
  `relatedFiles`); batch write-back on recall hits —
  `get_relevant_memories` + `mega_recall` returned entries only,
  best-effort (never fails the read), skipped when the entry's
  `lastActiveAt` is < 1h old (`RECALL_TOUCH_DEBOUNCE_MS`, bounds write
  amplification on per-project JSON).
- `effectiveConfidence` decay ref becomes
  `lastActiveAt ?? updatedAt ?? createdAt`. Legacy rows (no
  `lastActiveAt`) behave bit-identically — snapshot tests pin ranking
  order before/after. Approve/reject/sweep no longer reset age (they
  never touch `lastActiveAt`).
- `sweepMemoryTiers` idle keying: unchanged (out of scope).

### 4.4 MOVE 3b — `changedFrom` recall enrichment

Per hit `h` with `h.supersedesId`, where predecessor `p` exists AND
`p.validTo != null` (reopened predecessors suppress the line):
`changedFrom = { title: p.title, closedAt: p.validTo, reason: h.reason ??
p.reason }`. Immediate predecessor only — never the chain (token
discipline). Shared helper `enrichWithChangedFrom` in core.

Surfaces (all four):
1. `get_relevant_memories` — both return branches (semantic + BM25);
   result type widens additively.
2. `mega_recall` — inside the `inProcess` closure (predecessor lookup is
   free from the already-loaded `allMemory`). Note: the daemon
   `/recall-registry` route has no server-side handler today; if one ever
   lands it must mirror the enrichment (comment in code).
3. Connector block — data resolved in `buildConnectorContext` (the only
   holder of the unfiltered list), carried through `ConnectorContext`
   schema, rendered by `renderMemoryEntries` as a one-line suffix:
   `(changed from: "<pred.title>", closed <validTo>)`. Predecessor title
   passes the existing sentinel guard. Plus the §3.3 validity fix.
4. Warm-start brief — suffix inside `memLine`; the greedy budget fill
   meters it automatically (a long changedFrom can evict later lines —
   accepted, budget honesty beats completeness).

### 4.5 MOVE 3c — CLI surface

- **`mega memory history <id> [--json]`** (new `history.ts`): resolves
  entry → project → `buildLineage`; prints oldest→newest: id, title,
  `validFrom → validTo` (open end = `current`), reason. **PRO** —
  gate-first with `checkEntitlement("savings-analytics", …)`; free tier
  prints `"N prior versions. Memory history is a Mega Saver Pro feature.
  Activate a key: mega license activate <key>."` then exit 0 (N computed
  from the chain — cheap and honest, since chains only form via
  supersession).
- **`mega memory reopen <id>`** (new `reopen.ts`): undo — patches
  `{ validTo: null, updatedAt: now }`. Errors if the entry has no closed
  validity. **FREE** (the safety valve for auto-supersede cannot sit
  behind the paywall). Does not touch the successor's immutable
  `supersedesId`; the `changedFrom` guard (`p.validTo != null`) makes the
  stale line disappear.
- **`mega memory search --as-of <iso>` / `list --as-of <iso>`**: search
  plumbs the flag straight into the existing core `asOf`; list applies
  `isCurrent(asOf)` only when the flag is present (default output
  byte-identical). **PRO, per-flag gate**: flag present + not entitled ⇒
  upsell + exit 0; without the flag both commands stay fully free.
- **`mega memory explain`**: third section loop
  `formatMemoryLineageLines` — supersedesId, validFrom/validTo, immediate
  predecessor/successor titles.

## 5. Free/Pro split

| Capability | Tier |
|---|---|
| Auto-supersede detect + link + close, dedupe, evidence notes | FREE |
| create/save_memory output lines + response fields | FREE |
| `changedFrom` on all four recall surfaces | FREE |
| `mega memory reopen` | FREE |
| `mega memory history` | PRO |
| `search`/`list` `--as-of` | PRO (per-flag) |

Key: existing `savings-analytics` (checkEntitlement ignores the param;
key choice is call-site documentation). No new `ProFeature` member.

## 6. Data model & compatibility

Purely additive: optional `lastActiveAt`; optional `changedFrom` on tool
*responses* (never persisted); `supersession?`/`deduped?` response
fields. Old CLIs read new store files fine pre-1.0. `.megabrain`
export/import unchanged — chains ride along as ordinary rows
(`supersedesId` already in schema; import already forces `suggested` and
strips `supersedesId`, so no cross-machine auto-close).

## 7. Failure semantics

- Detection never blocks a save: any throw inside
  `detectSupersession`/cosine overlay degrades to plain create
  (try/catch at the `saveMemoryWithLineage` boundary; method tag makes
  degradation visible where it matters).
- Recall write-back (`lastActiveAt`) is best-effort; a failed touch never
  fails the read.
- `applySupersession` keeps today's silent-skip on invalid target — but
  the *response* now reports what happened (supersession field), removing
  the current invisibility.
- Concurrent double-supersede: atomic tmp+rename store; close idempotent
  (validTo already set ⇒ target validation skips). Documented ceiling, no
  locking.

## 8. Testing

- Table-driven `detectSupersession` fixtures ARE the spec: exact dup,
  negation flip ("use npm" / "never use npm"), file-overlap divergence,
  ambiguous cosine band, unrelated, muted via `--no-supersede`, explicit
  supersedesId beats detection, session-scope compatibility.
- Declared-target exemption: approve of a linked candidate flips + closes
  (regression: unlinked supersession conflict still quarantines;
  duplicate still auto-rejects).
- `applySupersession` extraction: existing `approve-memory` tests green
  unchanged (pure-refactor gate).
- Ranking snapshot tests pin ordering pre/post decay rekey for legacy
  rows; new-row `lastActiveAt` behavior tested separately.
- Per-surface `changedFrom` render tests incl. sentinel guard + reopened
  predecessor suppression + connector validity fix.
- CLI: history chain output, free-tier upsell (both commands + per-flag
  --as-of), reopen roundtrip (close → reopen → changedFrom gone →
  search finds both rows).
- E2E smoke (DoD evidence): create A → create contradicting A′ ⇒ A′
  carries `supersedesId`, A closed; `search` returns only A′;
  `search --as-of <before>` returns A; `history A′` prints the chain;
  `reopen A` restores.
- Cosine path unit-tested with injected vectors (no model download);
  real-model E2E only behind `MEGA_EMBED_E2E` env.

## 9. Risks

1. **False-positive auto-close = silent recall loss** (the
   CRITICAL-adjacent one). Mitigations: agent writes are born `suggested`
   (close only at human approval); 0.80 cosine bar; ambiguous band
   deliberately links nothing; `reopen` undo; lineage always inspectable;
   nothing is ever deleted.
2. Sidecar stale/absent ⇒ lexical-only, tagged `method`, never blocks.
3. Ranking regression from decay rekey ⇒ snapshot-pinned; legacy rows
   bit-identical.
4. Write-back amplification ⇒ 1h debounce, hit-set only, best-effort;
   fine at hundreds of rows (storage rework out of scope).
5. Exemption loosens the quarantine ⇒ scoped to the exact declared
   target only; adversarial review must attack this specifically.

## 10. Out of scope (v1)

LLM-confirm on the ambiguous band; GUI history scrubber; daemon
`/recall-registry` handler; storage-format rework; `sweepMemoryTiers`
rekey; embedding-on-save for CLI create; `brain-import` lineage.

## Packages touched

`core` (supersession.ts, memory-entry.ts, memory-search snapshot area,
warm-start.ts, index.ts exports), `mcp-bridge` (save-memory,
approve-memory, get-relevant-memories, recall, from-session-memory),
`connectors/shared` (context.ts, render.ts), `cli` (memory
create/update/history/reopen/explain/search/list, connector/shared.ts,
task/status.ts), changeset for all bumped packages.
