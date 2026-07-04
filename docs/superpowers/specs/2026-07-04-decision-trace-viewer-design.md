---
title: Decision-Trace Viewer (flagship — surface the causal chain MegaSaver already records)
date: 2026-07-04
status: approved
risk: MEDIUM-HIGH
scope: join replay-trace + evidence-ledger into a per-output causal record; default-on retention-capped tracing; CLI `mega trace explain`; GUI Cytoscape decision-flow panel
base: main
reviewers: [code-reviewer, critic]
---

# Decision-Trace Viewer

## Motivation

No coding agent exposes *why* a given context/decision happened. MegaSaver
already **records** the causal substrate — it just doesn't surface it:

- `replay-trace` (`output-filter`) records, per output, the `classification`,
  `decision`, and the ranked `selected[]`/`omitted[]` chunks each with an
  `EngineScore` (`baseRelevance` / `memoryBoost` / `failureHistoryBoost` /
  `finalScore`).
- `evidence-ledger` records, per output, `returnedChunkRefs`,
  `pinnedByMemoryIds` (which memory entries pinned the context), and the
  `redactionReport`.

The flagship turns this recorded-but-hidden data into a **human-legible causal
chain**: *intent → which memory drove this output's context → ranking decision
→ selected/omitted chunks + scores → redaction → output.* This is the trust /
"research-grade coding OS" story, reachable because ~80% is already recorded.

## Locked decisions (verified against code)

- **Join key = `chunkSetId`.** Each output has one `chunkSetId`; the trace
  (`ReplayTrace.chunkSetId`, `replay-trace.ts:92`) and its evidence record
  (`returnedChunkRefs[].chunkSetId` / `redactedRawChunkSetId`) join 1:1 at
  **output granularity**.
- **v1 is output-granularity.** `ChunkRef` (`replay-trace.ts:12`) carries no
  chunk id and `evidence.returnedChunkRefs` is a single `{chunkSetId,
  chunkId:'0'}`, so *per-selected-chunk* memory attribution is NOT recorded
  today. v1 shows memory pins + redaction at the OUTPUT level (joinable now, no
  enrichment). Per-chunk memory attribution = deferred (needs a `chunkId` on
  `ChunkRef` + per-chunk evidence — see Non-goals).
- **Full chain, GUI panel + thin CLI, default-on retention-capped tracing.**
- Registry-path outputs only (overlay/hook path writes no traces — §P2.6).

## Design

### 1. Join reader — `@megasaver/output-filter` (or a small new consumer)

New pure reader producing the causal record. Reuses `readReplayTraces`
(exists, from the seam Phase-2 work) + an evidence-ledger read.

Note the two stores key differently — traces by `projectId` (`stats/<projectId>/…`),
evidence by `workspaceKey` (`evidence/<workspaceKey>/…`) — so the reader takes
both; the join across them is still purely by `chunkSetId`.

```
readSessionDecisionTrace(store, { projectId, sessionId, workspaceKey }): SessionDecisionTrace

SessionDecisionTrace = { projectId, sessionId, outputs: DecisionOutput[] }
DecisionOutput = {
  chunkSetId, toolName, createdAt,
  classification: { category, confidence },
  decision,                          // passthrough|light|compressed|unchanged-marker|outline
  selected: RankedChunkView[],       // startLine,endLine,score,engine(baseRelevance,memoryBoost,failureHistoryBoost,finalScore)
  omitted:  RankedChunkView[],
  memory:   { pinnedByMemoryIds: string[] } | null,   // from the joined evidence record
  redaction: { secretsRedacted: number, categories: string[] } | null,  // from evidence redactionReport
  evidencePresent: boolean,          // false ⇒ orphan trace (evidence write failed) — render trace-only
}
```

- Read traces from `stats/<projectId>/<sessionId>-traces/replay-traces.jsonl`
  (JSONL, one trace per output). Read evidence from
  `evidence/<workspaceKey>/*.json`; index by `chunkSetId`. Join each trace to
  its evidence by `chunkSetId`; when absent → `evidencePresent:false` (graceful,
  not an error).
- Best-effort: a corrupt trace line / evidence file is skipped, never fatal.
- workspaceKey is resolved from the session (same as the existing bridge).

### 2. Tracing default-on + retention prune — `output-filter` + `content-store`/`context-gate`

- Flip `seamTraceEnabledByEnv` (`rank.ts:157`) so tracing is **on by default**,
  disabled only by `MEGASAVER_SEAM_TRACE=false`/`0`. (The two registry seam
  sites already gate on it — `run.ts:135`, `run-command.ts:260`.)
- **Retention (net-new, small):** a trace prune mirroring
  `content-store.pruneOlderThan` (`store.ts:225`) but for
  `stats/<projectId>/<sessionId>-traces/` dirs — keep the most recent
  `MAX_TRACE_SESSIONS` (e.g. 20) sessions' trace files, prune older. Invoke it
  best-effort at the seam write path (or a `mega trace gc`). Traces are the ONLY
  new always-on disk; the cap bounds it. Evidence already has `gcEvidence`.

### 3. CLI — `mega trace explain <sessionId>` (apps/cli)

Mirror `mega audit seam` (`apps/cli/src/commands/audit/seam.ts`): resolve store,
call `readSessionDecisionTrace`, render. Text by default (per output: the causal
chain — intent/tool → memory pins → decision → top selected chunks w/ score
breakdown → redaction), `--json` for the raw `SessionDecisionTrace`. Register
under a new `mega trace` command group (or `mega audit trace`).

### 4. GUI panel — Cytoscape decision-flow (apps/gui)

Mirror `apps/gui/src/views/cockpit/memory-graph-panel.tsx` (Cytoscape already a
GUI dependency) + a bridge route + a `claude-sessions-client` fetch fn:

- New bridge route `GET .../decision-trace` returning `SessionDecisionTrace`
  (resolve workspaceKey/session server-side like the token-saver route).
- Client `fetchSessionDecisionTrace(dir, id)`.
- Panel: a per-output causal flow — nodes for *tool/intent → memory pin(s) →
  ranking decision → selected chunks (sized/colored by finalScore, tooltip =
  EngineScore breakdown) → redaction → output*; omitted chunks shown dimmed.
  Register as a new cockpit panel (`Trace`) beside the existing panels.
- Empty state when no traces (mirror the token-saver panel's honest empty copy):
  "No decision traces for this session yet — tracing is on by default; set
  MEGASAVER_SEAM_TRACE=false to disable."

## Non-goals (deferred)

Per-selected-chunk memory attribution (needs `chunkId` on `ChunkRef` + per-chunk
evidence pins — a v2 enrichment); overlay/hook-path traces; predictive concept
decoders (research); cross-session aggregate trace analytics beyond `audit seam`.

## Testing (TDD, non-tautological)

- **Join reader:** fixture store with 2 traces + 2 evidence records sharing
  `chunkSetId` → `outputs[]` join `pinnedByMemoryIds`/redaction onto the right
  output; a trace whose evidence is missing → `evidencePresent:false` (not
  dropped); corrupt trace line / evidence file skipped, rest intact. Mutation:
  joining on `sessionId` alone (not `chunkSetId`) mis-attributes a multi-output
  session → the test must fail under that mutation.
- **Tracing default:** env unset → a registry read/exec writes a trace file;
  `MEGASAVER_SEAM_TRACE=false` → no trace file (default flipped, kill-switch
  still works). Retention: >MAX_TRACE_SESSIONS sessions → oldest trace dirs
  pruned, newest kept.
- **CLI:** fixture session → `mega trace explain` shows the causal chain;
  `--json` matches `SessionDecisionTrace`; empty session → honest message,
  exit 0.
- **GUI:** bridge route returns the joined structure for a fixture store; panel
  renders the flow when data present and the empty copy when absent (mirror
  existing panel/bridge tests).
- `pnpm verify` green at each boundary; real smoke: enable tracing, run a
  proxied read that triggers a memory boost, then `mega trace explain` shows the
  memory→context→score→output chain.
