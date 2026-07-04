---
title: Decision-trace records memory/redaction INLINE on the trace, not via a cross-store join
updated: 2026-07-05
tags: [decision, decision-trace, replay-trace, evidence-ledger, output-filter]
---

# Decision-trace: inline persistence, not the chunkSetId join

**Locked-in (PR #227, feat/decision-trace-viewer).** The Decision-Trace Viewer
surfaces the causal chain behind each context decision (ranking → which memory
boosted it → selected/omitted chunks + scores → redaction → output). It records
that data **inline on the registry replay-trace**, NOT by joining two stores.

## The trap (do not rebuild it)

The original spec's "verified" locked decision was to join the replay-trace
(ranking) to the evidence-ledger record (memory pins + redaction) by
`chunkSetId` at output granularity. **That join is INERT with real data** — it
was verified structurally (both stores have a `chunkSetId` field) but never
against runtime co-occurrence. In reality the two stores are populated by
**disjoint code paths**:

- **Registry/proxy seam** — `context-gate/run.ts` `runOutputPipeline` +
  `run-command.ts` `runOutputExecCommand` — writes ONLY a replay-trace
  (`chunkSetId = newId()`), never an evidence record.
- **Overlay/hook seam** — `context-gate/record-output.ts` (via `appendEvidence`)
  — writes ONLY an evidence record (a separate `newId()`), never a trace.

A tool output goes through exactly ONE seam, so no output ever produces both,
and the two `chunkSetId`s are independent. `evidencePresent` is therefore always
false on the join path; memory pins + redaction never render. Evidence's
`pinnedByMemoryIds` is also always `[]` from `appendEvidence` (it is a manual
*retention* pin, not ranking attribution).

## The fix (what actually ships)

Record the attribution **inline on the registry trace**, the path that already
has the data:

- **Redaction** — both registry seams already compute `redactedCount(warnings)` +
  a `redacted` boolean at trace-write; stamped inline as
  `ReplayTrace.redaction { redacted, secretsRedacted }`.
- **Memory ids** — threaded id-carrying hints (`MemoryEntryView.id` →
  `SessionHints.memoryTerms {id,text}` → `matchedMemoryIds` collector →
  `RankingTrace.rankedByMemoryIds`, unioned across selected chunks). **Attribution
  only** — `recentMemory` stays the scoring input, so `memoryBoost`/`finalScore`
  are byte-identical (mutation-guarded parity test).
- **Reader** `readSessionDecisionTrace` prefers inline, falls back to the (now
  vestigial) evidence join so legacy fixtures still parse.

Rejected alternative: writing a co-keyed evidence record on the registry path —
that drags in the fail-closed evidence persistence path → CRITICAL risk. Inline
avoids the evidence ledger entirely (HIGH, not CRITICAL).

## Honesty semantics (naming matters)

- `rankedByMemoryIds` (renamed from `pinnedByMemoryIds`) = **ranking-causal**
  ("which memory boosted this output's ranking"), distinct from the evidence
  ledger's retention pin. The evidence-ledger's own `pinnedByMemoryIds` field is
  unchanged.
- `highRiskFindings` := the seam's redaction **count** (`secretsRedacted`), not a
  high-risk classification.

## Surfaces + key facts

- Tracing is **on by default** (`MEGASAVER_SEAM_TRACE=false` disables), bounded by
  `pruneTraceSessions` (cap `MAX_TRACE_SESSIONS=20`, ranked by trace-FILE mtime so
  an actively-appending session is not pruned).
- `mega trace explain <sessionId> --project <name> [--workspace <key>] [--json]`.
- GUI Cytoscape panel with a **project-scoped session picker** — the cockpit
  transcript UUID cannot auto-map to a registry trace (no persisted link), so the
  panel lists `stats/<projectId>/*-traces` for the project whose `rootPath === cwd`.
  The `?session` param is validated with `sessionIdSchema` (path-traversal guard).
- Traces exist ONLY for registry/proxy sessions; pure cockpit/overlay sessions
  show an honest empty state.

## Deferred
Per-chunk memory attribution (per-output only); unifying the overlay+registry
seams or persisting a transcript-UUID↔registry-sessionId link (keeps GUI auto-map
out of reach); co-keyed evidence on the registry path.
