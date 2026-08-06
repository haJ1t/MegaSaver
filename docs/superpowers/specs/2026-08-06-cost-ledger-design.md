---
feature: cost-ledger
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "10 of 11 (next-wave batch)"
---

# Unified Cost Ledger (C4)

## Problem

Pain P3 — cost explosion + invisibility
(`wiki/syntheses/vibe-coding-pains-2026.md`): spend is invisible per
project/task/agent/session. The receipts exist, in three stores, no rollup:

- **Proxy metering**: `<store>/proxy-usage/usage.jsonl` — one `ProxyUsageEvent`
  per `/v1/messages` round-trip (`packages/llm-proxy/src/usage-event.ts`):
  `{ id, ts, model, inputTokens, outputTokens, cacheReadTokens,
  cacheCreationTokens, messageCount, stream, workspaceKey? }`. Counts only —
  no USD field, no session id; `workspaceKey` reserved (F33), never stamped
  today (single global listener).
- **Saver savings**: `TokenSaverEvent` rows in the two `stats/` layouts:
  registry `stats/<projectId>/<sessionId>.events.jsonl` and overlay
  `stats/<workspaceKey>/<liveSessionId>.events.jsonl`
  (`packages/stats/src/event.ts`).
- **Session metadata**: registry sessions carry `agentId`
  (`packages/core/src/session.ts`); task labels arrive as Session Mesh
  presence `taskLabel` (contract locked in the mesh plan,
  `2026-08-06-session-mesh.md`; not yet implemented).

`mega audit usage` answers only "% of usage saved", globally — nothing
answers "where did this week's tokens go".

## Goal

`mega cost [--by project|task|agent|session] [--since <iso|Nd|Nh>] [--json]` —
one read-only rollup joining the three sources. Per group: the four spend
token counters, spend receipts count, measured saved tokens, measured/
unmeasured savings receipt counts; plus a totals row and overall receipts
count. Unattributable rows land in an explicit `UNKNOWN` bucket — never guessed.

## Non-Goals (YAGNI)

- USD figures. No billed cost is persisted anywhere in the store, and the
  shipped dated price table (`MODEL_LIST_PRICES`, `model-prices.ts`) prices
  input tokens only; a 4-class spend estimate needs a new dated price
  contract (open question).
- Projections or extrapolation of any kind ("you saved $X", run-rate,
  forecast — `mega savings forecast` owns budget forecasting).
- Stamping `workspaceKey` on proxy rows (writer change on the proxy path —
  its own spec; `packages/stats/src/net-effect.ts` header explains why).
- Including `TaskKickoffEvent` rows: a kickoff cost row proves only a
  successful local stdout callback before the deadline, not that Claude
  consumed the pipe (task-kickoff safety amendment §1/§3; echoed in
  `wiki/agent-channel.md` 2026-08-02). Neither spend nor savings — excluded.
- GUI panel, daemon route, budget alarms (`mega alerts` owns those); any
  writer or event-schema change. Read side only.

## Locked Decisions

1. **Receipts only (honest-metrics hard rule).** Every number is a sum over
   rows on disk. No extrapolation, no projections, no bytes/4 conversion into
   the savings column. Precedents: interception-only-with-hook-log
   (`wiki/entities/stats.md` v1.2), % suppression in `runAuditUsage`, the
   measured/estimated split in `packages/stats/src/estimated-value.ts`.
2. **Savings require a real before/after receipt pair.** A row counts toward
   saved tokens iff the writer measured it — `deltaTokens` present
   (`deltaTokensOf`, `packages/stats/src/event.ts`, which deliberately never
   falls back to bytes/4). Pair-less rows surface as `unmeasuredSavingsRows`,
   a count, never converted.
3. **UNKNOWN is a first-class bucket.** Proxy rows carry no session/agent/task
   signal and (today) no `workspaceKey` → they land in `UNKNOWN` on every
   facet except `--by project` when a row is stamped. The renderer prints the
   bucket with a one-line reason; JSON carries the key `"UNKNOWN"`.
4. **Tokens, not dollars** (v1). Spend = the four token counter classes.
5. **Read-only; the single permitted write is an optional cache**,
   `<store>/cost-ledger/cache.json`, invalidated by an mtime+size fingerprint
   of the walked `.events.jsonl` files; best-effort (any failure → silent
   recompute). No other write of any kind.
6. **Every `stats/` walk discriminates the two layouts** — overlay dirs are
   16-hex (`workspaceKeySchema`, `packages/shared/src/workspace-key.ts`),
   registry dirs are UUIDs — per the standing rule in
   `wiki/entities/stats.md` ("Two layouts share `stats/`").
7. **Mesh is a soft dependency.** `<store>/mesh/presence/<liveSessionId>.json`
   (`agent`, `taskLabel` — locked `PresenceRecord`, see component 4) is read
   tolerantly when present; absent or unreadable → agent/task facets degrade
   to `UNKNOWN`. Mesh is build-order 1 of 11 and may not exist on disk when
   this ships.
8. **Pure aggregation lives in `@megasaver/stats`; the CLI consumes it via
   `@megasaver/core`.** Phase 8 precedent + §3c rule (apps/cli never imports
   stats directly) — re-export through `packages/core/src/context-gate.ts`.

## Architecture

```
<store>/proxy-usage/usage.jsonl ──readProxyUsage──────► SpendReceipt[] (+skippedLines)
<store>/stats/<16-hex>/<live>.events.jsonl ─┐
<store>/stats/<uuid>/<sess>.events.jsonl  ──┴─disc. walk──► SavingsReceipt[] (cacheable)
registry sessions (agentId) ──────────────────┐
<store>/mesh/presence/<live>.json (soft dep) ─┴──merge──► Map<sessionId, CostSessionMeta>

   all three ──► buildCostLedger({ facet, sinceMs, … }) [pure] ──► table / --json
```

## Components

1. **Pure builder** — `packages/stats/src/cost-ledger.ts`:
   `buildCostLedger(input): CostLedger`. Facet keying, since-window, UNKNOWN
   routing, group sort (named groups by spend tokens desc, `UNKNOWN` always
   last), totals, `skippedUsageLines` passthrough.
2. **Core re-export** — new block in `packages/core/src/context-gate.ts`;
   guard test mirrors `packages/core/test/audit-reexport.test.ts`.
3. **Collectors** — `apps/cli/src/commands/cost.ts`: spend via
   `readProxyUsage` (`@megasaver/llm-proxy`, torn lines counted); savings via
   the discriminated `stats/` walk, loose per-line parse (`runAuditUsage`
   precedent); registry meta via `createJsonDirectoryCoreRegistry({ rootDir })
   .listProjects()` / `.listSessions(projectId)`.
4. **Mesh presence reader** — tolerant read of
   `mesh/presence/<liveSessionId>.json`. Locked contract (session-mesh
   plan, build-order 1): `PresenceRecord` `{ liveSessionId, workspaceKey,
   agent, cwd, branch?, taskLabel?, status, registeredAt, lastSeenAt }`;
   the ledger parses only `{ liveSessionId, agent, taskLabel }`, non-strict,
   keyed by `liveSessionId`. Merge rule: agent from the registry wins
   (validated `agentIdSchema` enum); task labels come from mesh `taskLabel`
   only. Registry session ids and transcript live session ids are distinct
   id spaces — a registry row gains a task label only when its id equals
   the live session id; otherwise registry rows get no task attribution.
5. **CLI command** — `mega cost`, new top-level command registered in
   `apps/cli/src/main.ts`; injectable readers per the `RunAuditUsageInput`
   pattern in `apps/cli/src/commands/audit/usage.ts`.
6. **Optional cache** for the savings walk (decision 5), `cost-cache.ts`.

## Error handling

- Missing store/dir/file → empty inputs, never a crash (ENOENT → `[]`).
- Torn/garbage JSONL lines are skipped; usage lines additionally COUNTED
  (`readProxyUsage().skippedLines`) and rendered as a warning (F32 precedent).
- Registry unreadable → empty meta map (agent facet degrades to `UNKNOWN`).
- Invalid `--since` → one error line + exit code 1; no partial table.
- Windows-safe: every path via `node:path` `join`; no `fs.watch`; cache write
  is atomic tmp+rename inside try/catch — a Windows `EPERM` rename degrades
  to silent recompute (seen-ledger lesson, PR #315 line).

## Security & privacy

- Reads counts and labels only; the usage log is counts-only by design (never
  bodies, prompts, or auth headers — `packages/llm-proxy/src/usage-event.ts`).
- Mesh task labels are SECRET-REDACTed at write time per the mesh spec; the
  ledger re-prints stored labels only. Cache file 0600 under the operator's
  store; contains only fields it read.

## Testing

- Unit (stats): facet keying, UNKNOWN routing, measured-pair rule,
  since-window, sort order, totals, empty inputs.
- CLI: fixture store dirs (mkdtemp; real 16-hex + UUID dirs, like
  `apps/cli/test/audit/session-overlay.test.ts`); layout discrimination
  (decoy files/dirs skipped); injectable-reader command tests like
  `apps/cli/test/audit-usage.test.ts`; mesh-absent degrade; cache hit /
  stale-fingerprint miss / corrupt-file miss.
- No timing-tight assertions (CI-slowness lessons: structural guards only).

## Risk & process

MEDIUM (§12): read-only reporting over existing stores; no writer, schema, or
core-path change. Full superpowers chain; required reviewer: `code-reviewer`.
Escalation → HIGH if implementation touches any writer/schema (e.g. proxy row
stamping) or any output computes a projection.

## Dependencies / build order

"10 of 11" in the next-wave batch. Soft dep: session-mesh (1 of 11) presence
files — degrade per decision 7. Reuses: `readProxyUsage`, stats event schemas
+ `deltaTokensOf`, `workspaceKeySchema`, the core registry, and
`wiki/workflows/cli-test-pattern.md`. Enables: mesh A5 per-session burn
column, C1 budget circuit breaker (same joined receipts).

## Open questions

- A dated 4-class price contract for a labeled USD *estimate* column (extends
  `model-prices.ts`; must carry `capturedAt` like `estimateSavedValue`).
- Proxy `workspaceKey` stamping (F33) to shrink UNKNOWN — separate spec.
- Whether the cache earns its keep after dogfood (measure real walk time); it
  may be deleted, not grown.
