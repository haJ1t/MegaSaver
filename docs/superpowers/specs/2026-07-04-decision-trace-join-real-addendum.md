---
title: Decision-Trace — make the memory/redaction join REAL (addendum)
date: 2026-07-04
status: proposed
risk: HIGH
supersedes-premise-of: docs/superpowers/specs/2026-07-04-decision-trace-viewer-design.md
base: feat/decision-trace-viewer (Slices 1-4 committed)
reviewers: [code-reviewer, critic]
---

# Addendum: making the decision-trace join real

## Why this exists

The original spec's locked decision — *"the trace and its evidence record join
1:1 by `chunkSetId` at output granularity"* — was **verified structurally but
not against runtime**. Confirmed in code (adversarial critic + main-thread):

- The **registry/proxy seam** (`context-gate/run.ts` `runOutputPipeline`,
  `run-command.ts` `runOutputExecCommand`) writes **only a replay-trace**
  (`chunkSetId = newId()`), never an evidence record.
- The **overlay/hook seam** (`context-gate/record-output.ts`) writes **only an
  evidence record** (a separate `newId()` via `appendEvidence`), never a trace.
- A tool output goes through exactly ONE seam. So no output ever has BOTH, and
  the two `chunkSetId`s are independent → the join is **inert** with real data:
  `evidencePresent` is always false, memory pins + redaction never render.

The `readSessionDecisionTrace` reader, `mega trace explain` CLI, and GUI panel
(Slices 1-4) are code-correct but surface only the ranking half. This addendum
makes the causal chain (**which memory boosted this output + redaction**) real
by recording that data **inline on the registry trace** — the path that already
has it — instead of relying on the unreachable cross-store join.

## What the registry path already has (verified)

- **Redaction:** both seams compute `redactedCount(warnings)` and a `redacted`
  boolean (`warnings.some(w => w.startsWith("redacted"))`) at trace-write time
  (`run.ts:200-213`, `run-command.ts`). No new computation.
- **Memory content, but not ids:** ranking matches chunk text against
  `memoryItems = [...recentMemory, ...projectConventions]` (`rank.ts:188`,
  plain `string[]`). The memory **id** exists at `listMemoryEntries`
  (`MemoryEntry.id`) but is dropped at the port (`registry-port.ts`
  `MemoryEntryView` omits `id`) and in the `Set<string>` flatten
  (`session-hints.ts`). Threading it back is additive and practical.

## Design

### 1. Memory-id threading (attribution-only; ranking score UNCHANGED)

Smallest change that names the memories, **per output** (union across the
selected chunks — per-chunk is deferred):

- `registry-port.ts` — add `id: string` to `MemoryEntryView` (core's branded
  `MemoryEntry.id` is structurally assignable).
- `rank.ts` `SessionHints` — add optional `memoryTerms?: readonly {id:string;
  text:string}[]`, **parallel** to `recentMemory`/`projectConventions`. Scoring
  input stays `recentMemory` → `memoryBoost`/`finalScore` bytes never change.
- `session-hints.ts` — accumulate `{id,text}` pairs alongside the existing set,
  capped by `MAX_HINT_ITEMS`.
- `rank.ts` — a `matchedMemoryIds(text, terms)` collector (no score effect);
  attach matched ids per ranked chunk.
- `replay-trace.ts` — `RankingTrace.pinnedByMemoryIds?: string[]` (optional),
  unioned across `selected` chunks in `buildRankingTrace`.
- `output-filter/types.ts` + `context-gate/read.ts` — thread `memoryTerms`
  through the `filterOutput` zod input (`.strict()` requires it declared).

### 2. Persistence: INLINE in the trace (not a co-keyed evidence record)

Writing a co-keyed evidence record on the registry path would introduce a new
write into the **fail-closed evidence/redaction persistence path** → CRITICAL
risk. Inline avoids the evidence ledger entirely and is HIGH-risk. All fields
optional/additive; legacy traces and seam-off runs parse unchanged.

- `ReplayTrace.redaction?: { redacted: boolean; secretsRedacted: number }`
  (top-level — redaction is a seam fact). Threaded via `ReplayTraceMeta` +
  `finalizeReplayTrace`; both seams pass `{ redacted, secretsRedacted:
  redactedCount(warnings) }`.
- `RankingTrace.pinnedByMemoryIds?: string[]` (§1).
- **Reader** (`decision-trace.ts`) prefers inline, falls back to the evidence
  join so Slice-1's evidence-only fixtures still pass:
  ```
  memory      = inline.pinnedByMemoryIds?.length ? {pinnedByMemoryIds: inline...}
              : ev ? {pinnedByMemoryIds: ev.pinnedByMemoryIds} : null
  redaction   = inline.redaction ? {redacted, highRiskFindings: secretsRedacted}
              : ev ? ev.redaction : null
  evidencePresent = ev !== undefined || inline.pinnedByMemoryIds !== undefined
                  || inline.redaction !== undefined
  ```

### 3. GUI: project-scoped trace/session picker

Auto-mapping a cockpit session (Claude transcript UUID) to a registry trace
(keyed by a `mega session create` randomUUID) is **impossible** — neither seam
persists a transcript-UUID ↔ registry-sessionId link. Honest deliverable: a
**picker**. Given the cockpit `dir/id` → resolve `cwd → projectId`
(`rootPath === cwd`) → list `stats/<projectId>/*-traces/` (each = a registry
sessionId) with a count + latest `createdAt` → operator selects one →
`readSessionDecisionTrace({projectId, sessionId: picked, workspaceKey})`. The
graph projection (`decision-trace-graph.ts`) is UNCHANGED. The CLI already takes
the registry `sessionId` positionally and works once §1-§2 land.

## Three honesty decisions (require sign-off)

1. **`pinnedByMemoryIds` semantics.** In the evidence ledger this means a manual
   *retention pin*. Our inline value means *"memories whose hint terms boosted
   this output's ranking"* — ranking-causal, a different concept. **Decision:
   keep the surfaced field name `pinnedByMemoryIds` (no CLI/GUI/test churn) and
   document the honest meaning** (inline = ranking-causal; evidence-join =
   retention pin). Alternative if preferred: rename to `rankedByMemoryIds`
   end-to-end (pre-1.0, allowed) — more churn, clearer name.
2. **`highRiskFindings` has no true seam source** — only `secretsRedacted`
   (a count). **Decision: map `highRiskFindings := secretsRedacted`** with a doc
   note (truthful as "N secrets redacted"; NOT the evidence ledger's high-risk
   classification).
3. **GUI stays empty for workspaces with no matching registry project** (pure
   overlay/cockpit workspaces never ran the proxy). The picker shows an honest
   empty state; we do NOT fabricate a mapping.

## Risk & guards (HIGH)

Packages: `context-gate` (registry-port, session-hints, run/run-command),
`output-filter` (rank, types, replay-trace, decision-trace), `apps/gui` (picker
route + wiring). NOT CRITICAL — no new write into the fail-closed evidence
persistence path; ranking score bytes unchanged.

- **Ranking parity:** `memoryTerms` is attribution-only; a regression test
  asserts `memoryBoost` identical with/without it. (Mutation: using
  `memoryTerms` as the scoring input must fail the parity test.)
- `mega audit seam` reads only existing fields — add a smoke test that a trace
  with the new optional fields still summarizes.
- Slice-1 `decision-trace.test.ts` (evidence-only join) must stay green
  untouched (inline `undefined` → falls through to evidence).
- `filterOutput` zod is `.strict()` — `memoryTerms` must be declared or it throws.
- `MemoryEntryView.id` required-vs-optional: grep test doubles first.

## Slice breakdown (TDD, dependency order)

- **Slice A — redaction inline** (smallest): `ReplayTraceMeta.redaction` +
  schema + `finalizeReplayTrace`; both seams stamp it; reader prefers
  `t.redaction`. Test: registry-only trace (no evidence dir) →
  `outputs[0].redaction.redacted===true`, `evidencePresent===true`. Critic:
  drop the field from one seam only → both `read` and `exec` traces must carry it.
- **Slice B — memory-id threading**: registry-port `id`, `SessionHints.
  memoryTerms`, `matchedMemoryIds`, `RankingTrace.pinnedByMemoryIds` union,
  zod threading. Test (rank-level): matched id surfaces AND `memoryBoost` equals
  the `recentMemory`-only value (parity). Critic: swap scoring input → parity fails.
- **Slice C — reader prefers inline + e2e proof**: seam integration test — run
  `runOutputPipeline` with an approved memory whose term appears in the file,
  ranking+tracing on → `readSessionDecisionTrace` populates
  `memory.pinnedByMemoryIds` with NO evidence dir written. Critic: legacy
  evidence-only fixture still joins (fallback ordering).
- **Slice D — GUI picker**: bridge list route + panel wiring. Test: `cwd`
  matches a project with two `*-traces/` dirs → both listed with counts;
  selecting one → populated graph. Critic: no matching project → empty list +
  honest empty state (no fabricated trace).

## Non-goals (defer)

Per-chunk memory attribution (per-output only); unifying the overlay+registry
seams or persisting a transcript-UUID↔registry-sessionId link (keeps GUI
auto-map out of reach — the picker is the answer); co-keyed evidence on the
registry path; making the overlay seam write traces; end-to-end field renames.
