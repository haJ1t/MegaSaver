# Saver Audit Fixes — Plan

- **Date:** 2026-07-31
- **Spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`
  (approved plan of record; this plan executes its residual defect inventory)
- **Origin:** end-to-end architecture audit 2026-07-31 (24-agent workflow:
  7 scanners, adversarial verification of all P0/P1 findings, synthesis).
  63 raw findings → 14 confirmed P1 (deduplicated to 9 distinct defects) +
  47 P2/P3.
- **Risk:** HIGH (saver/compression domain per §12). Worktree
  `worktree-feat-saver-audit-fixes`; no main edits; `code-reviewer` + `critic`
  in fresh contexts before merge.
- **Lane boundary:** `packages/bench-replay` is actively owned by the other
  agent (A4 real-API measurement leg, commits `14fe2039`…`e5a7a6f6`). This
  plan does not touch it.

## Fix units (TDD, one commit each)

### Cluster A — `apps/cli` (hook path)

1. **Safe-mode Bash floor** (HOOK-1, confirmed). `minBytesFor`'s Bash branch
   `Math.max(budget + 1, Math.min(budget, BASH_COMPRESS_FLOOR))` is identically
   `budget + 1`; under safe that is 32 001 — above Claude Code's ~30 000-char
   truncation ceiling — so single-stream foreground Bash can never compress in
   safe mode, while the same output via BashOutput/Monitor gates at 24 000.
   The `budget + 1` premise (pre-A4 fit-to-budget) is gone since `targetBudget`.
   Fix: foreground Bash uses `Math.min(budget, BASH_COMPRESS_FLOOR)` like the
   background branch; rewrite the C4 pin test; fix the saver.ts:30-33 comment.
2. **Grep/Glob filenames rebuild** (HOOK-2, confirmed). The rebuild splits
   compressed text into `filenames[]` after stripping summary, gap markers and
   recovery footer — so no compression signal or recovery handle reaches the
   model, and `numFiles` still claims the original count. Fix: deliver an
   explicit truncation marker + recovery footer through the rebuilt array
   (or alongside it), keep `numFiles` honest, W4-style hook-level test.
3. **stderr boundary out-of-band** (HOOK-4, P2). The synthetic
   `--- STDERR ---`-style boundary line is a rankable, droppable chunk and is
   persisted as command output. Fix: carry the split out-of-band (structured
   field), never as an in-band line.

### Cluster B — `packages/output-filter`

4. **Evidence-marker reservation for all compressor markers** (SC3-3,
   confirmed). `fitBudget` protects only `normalize`'s two marker forms;
   every compressor-emitted counted marker (prose/json/vitest/tsc/diff) is
   droppable under budget pressure (B7 family). Fix: reserve all counted
   markers ahead of score.
5. **Dedupe band gating** (SC3-2, confirmed; spec B10). `dedupe()` runs on
   passthrough/light bands, contradicting the "keep all chunks" contract, and
   its drops are uncounted in every band. Fix: dedupe only in the compressed
   band; count drops.
6. **Dedupe score-aware keep** (SC3-4, P2). First-in-document-order survives
   its near-duplicate cluster even when a later duplicate carries the error
   evidence. Fix: keep the highest-scored member.
7. **Outline delivered bytes** (SC3-1/S4-8, P2; spec item 2 / M13-live).
   Outline branch excludes its own summary from `returnedBytes`/
   `returnedTokens`. Fix: count summary; pin with deliveredBytes-identity test.
8. **parseGoTest omission accounting** (SC3-5, P2). Parser-level drops
   (passing blocks, preamble) are invisible to `droppedCount` and the summary.
   Fix: report parser omissions; explicit marker per W4.

### Cluster C — `packages/context-gate`, `packages/daemon`, `packages/stats`, `apps/gui`

9. **Overlay-event idempotency** (HOOK-3 / spec B11, confirmed). A client
   timeout after the daemon has written the overlay event makes the hook's
   in-process fallback write it a second time — savings double-counted; also
   distorts the recovery-rate term R now that A4 reads the real ledger. Fix:
   deterministic event identity + store-level dedupe.
10. **Unchanged re-read ledger** (S2-2/S4-5, confirmed; spec item 3). The
    unchanged branch returns before any ledger append with fabricated
    `returnedBytes: 0 / savingRatio: 1`. Fix: append an event carrying real
    `mcpEnvelopeBytes(unchangedResult)` and a signed delta.
11. **Daemon `/expand` expansion debt** (S2-3, P2). The route calls
    `fetchOverlayChunk` directly, bypassing the B3 recovery-debt event. Fix:
    route through the debt-recording path.
12. **Net savings surfaces** (S4-1, confirmed). GUI overview + savings
    headline show gross `bytesSavedTotal` while the ledger already records
    expansion debits (`deltaBytesTotal`). Fix: headline the signed net; keep
    gross as breakdown.

### Docs (after code)

13. **Truth sync** (HOOK-5/6, S2-6/7, S5-10/11 + verdict corrections): dated
    appendix to spec §7/§8 (items 9/10/17 resolved-by-revert; item 7
    trace-stripping amendment; B10-numbering cross-reference; DEFAULT_MODE
    mislabel — operative enabled default is `balanced` via the activation
    write paths, `safe` lives only in `disabled()` results; retracted-churn
    citations), stale W2 comments in `compress/prose.ts` / `compress/json.ts`,
    wiki outcome updates.

## Deferred (recorded, not dropped)

- **Unit 14** read/exec MCP delivery guard (L, needs design vs measured
  envelope data) — after A4 corpus lands.
- **Unit 15** `runOverlayOutputPipeline` wire-or-delete (needs architect
  decision).
- **Unit 10** fit-residual instrumentation in bench-replay (other agent's
  lane).
- Bench-replay comment staleness (HOOK-6) — other agent's lane; noted in
  docs unit instead.

## Gates

- Each unit red→green; `pnpm verify` green on the branch; conventions:check ok.
- `code-reviewer` AND `critic`, fresh contexts, author ≠ reviewer.
- Wiki updated (`syntheses/saver-root-cause-2026-07-28` outcomes, log entry).
- Adoption decision (floor/mode) explicitly NOT taken here — it stays gated
  on the A4 real-API leg per spec §8; this plan repairs the meter it will use.
