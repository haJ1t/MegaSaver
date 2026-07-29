---
title: Token Saver Root-Cause Investigation (2026-07-28)
tags: [token-saver, output-filter, context-gate, stats, root-cause]
sources: [syntheses/saver-cache-churn.md, concepts/context-gate-pipeline.md, entities/context-gate.md, entities/output-filter.md]
status: active
created: 2026-07-28
updated: 2026-07-28
---

# Token Saver Root-Cause Investigation (2026-07-28)

> **Companion page.** A second, independent audit ran the same day:
> [[syntheses/saver-root-cause-2026-07-28]]. The two agree on every
> architectural conclusion and were written without knowledge of each other.
> Read that one for the **measured receipts** (the mode × size ratio ladder, the
> chunk-3 coordinate-mismatch proof, the no-telemetry environment check) and for
> the list of claims that were checked and **refuted**. Read this one for the
> widest defect inventory. Both are cited by
> `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`,
> which is the approved plan of record.
>
> Corrections against current code (2026-07-28): item **A10 is wrong** —
> `appendAuditEvent` has a production caller,
> `apps/cli/src/commands/context/build.ts:38`; it is absent from the *saver*
> path, which is a coverage gap, not dead code. Item **B9 is overstated** —
> `saver.ts:154-167` joins every text block into `raw` and emits the compressed
> result in the first block's position, so all text survives; only inter-block
> boundaries are lost. Items A8 (daemon double count), B6 (dedupe on
> passthrough/light) and B8 (prose/json) were verified as real and are now
> B10–B12 in the spec.

User report: the saver (1) does not actually save tokens — sometimes delivers
more than the original — and (2) loses important information when it does
compress. Four-scope investigation (hook path, output-filter internals,
accounting, proxy/MCP paths). Investigation only; no fixes applied.

## A. Why it does not save (or expands)

1. **Cache churn (architectural, measured).** Hook rewrites `tool_result`
   in place → invalidates Claude Code prompt cache → re-billed as
   cache_creation. Net cost 0.93–0.97× (worse than baseline); first-sight
   ledger did not fix it (0.948×). See [[syntheses/saver-cache-churn]].
   Net-negative guard is byte-level only (`record-output.ts:232`), accepts
   1-byte savings as rewrite justification. No minimum-savings threshold.
2. **Re-injection never debited (architectural).** `mega output chunk` /
   `proxy_expand_chunk` / daemon fetch record no event; savings ledger only
   banks `bytesSaved` at compression time. Expand a few chunks back → net
   ≤ 0 while UI shows full gross saving.
3. **Unguarded MCP paths (bug).** Net-negative guard exists ONLY on the
   hook path. `runOutputPipeline` (run.ts) / `runOutputExecCommand`
   (run-command.ts) deliver summary + all chunks + JSON envelope
   (`server.ts:316`) with no guard → passthrough/light bands (≤2000 est.
   tokens) deliver strictly MORE than raw. Envelope (~250–350 B/excerpt)
   is delivered but never counted in `returnedBytes`.
4. **Safe-mode Bash dead zone (bug).** Floor 24 000 B < fit budget 32 000 B
   (`saver.ts:33,54` vs `modeToBudget("safe")`) → everything fits → guard
   fires → passthrough. Safe mode effectively never compresses Bash.
5. **First-sight ledger forfeits repeats (bug/design).** Seen-hash pass-through
   at full size (`saver.ts:321-325`); the duplicate tool_result is billed
   fresh as suffix content.
6. **Negative savings unrepresentable (bug).** `bytesSaved = max(0,…)`
   (`types.ts:351`); schema enforces ≥ 0 → expansions invisible in aggregates.
7. **Accounting is bytes/4 + flat $3/Mtok** (`tokens.ts:17-19`,
   `savings-headline.ts:8`) — displaced tokens priced as fresh input, not
   cache-read; all $ figures optimistic.
8. **Daemon-timeout double count (bug).** Hook falls back to in-process
   record after daemon already appended the event (`saver-run.ts:108-138`)
   → duplicate savings event.
9. **Proxy mode saves nothing by construction** — `llm-proxy` is a
   transparent metering proxy; no compressor in the HTTP path.
10. **Audit pipeline dead** — `appendAuditEvent` has no production caller;
    `summarizeAudit` always zero in real stores.

## B. Why it loses information (unsafe save)

1. **Excerpts-only persistence on 3 of 4 paths (architectural, biggest).**
   Only the hook path stores full redacted raw (`record-output.ts:178-191`).
   Read/exec/registry paths store only kept excerpts
   (`run-command.ts:390-396,636-642`, `read.ts:249-255`) → everything
   fitBudget dropped is unrecoverable. Tool copy ("Nothing is lost…",
   `search-code.ts:61-63`) and connector block claim otherwise — false.
2. **compressTsc silently deletes non-error lines (bug).**
   `compress/tsc.ts:16-34` drops global errors (no position), elaboration/
   continuation lines, code frames — no collapse marker. Misclassification
   at 0.7 confidence (`classify.ts:52,127-129`) routes ANY text quoting
   "error TS…" to it. No-blind floor only rescues the empty case.
3. **parseGoTest drops panics (bug).** `parsers/go-test.ts:15-30`: panicking
   test never prints `--- FAIL:` → panic + stack discarded when any other
   block survives.
4. **Heuristic fit to 4 KB budget (design).** Aggressive budget 4000 B;
   Task (subagent report) floor 16 384 B → 100 KB report shredded to 4 KB
   of keyword-picked fragments. Recovery is optional-for-the-agent.
5. **No-intent ranking (design).** `intent` often undefined on hook path →
   keywordScore 0 → fit pin inert → generic error heuristics decide.
   `errorScore` fires on "0 errors"; scores not size-normalized.
6. **Dedupe on passthrough/light (bug).** SimHash dedupe runs even in
   "keep everything" bands (`types.ts:296-302`), contradicting the
   "no signal dropped" comment.
7. **filenames rebuild corruption (bug).** `saver.ts:179-186`: summary line,
   gap markers, and recovery footer become fake paths in the rebuilt array;
   `numFiles` still reports original count → phantom files.
8. **compressProse / compressJson lossy on docs & data (design).** First
   paragraph per section, first 3 list items; JSON arrays >20 → first 3 +
   last 1 rows. Intent-matched keys annotated but values NOT preserved.
9. **Multi-text-block collapse (bug-lite).** `saver.ts:154-167` joins all
   text blocks, rebuild drops all but the first.
10. **Normalize markers can expand small inputs (minor bug).**
    `… [repeated N times]` emitted with no size check (`normalize.ts:31`).

## Verdict

Mixed: the headline "doesn't save" is **architectural** (cache-blind byte
accounting, no net measurement, uncounted recovery, proxy-by-design-none);
the "loses info" is **mostly plain bugs** (tsc/go-test parsers, excerpts-only
persistence, filenames rebuild) amplified by aggressive heuristics. The hook
path is the best-engineered of the four entry points; the MCP/registry paths
lack guard, full-raw store, and honest accounting. Fix direction: one guarded
shared pipeline + net (cache-aware, debit-on-expand) accounting, per
`docs/superpowers/specs/2026-07-19-cache-aware-saver-design.md`.
