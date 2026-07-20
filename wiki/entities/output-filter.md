---
title: '@megasaver/output-filter'
tags: [entity, package, output-filter, redaction, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
  - docs/superpowers/specs/2026-06-25-diff-on-reread-design.md
  - docs/superpowers/specs/2026-06-26-semantic-ast-read-design.md
status: active
created: 2026-05-11
updated: 2026-07-20
---

# `@megasaver/output-filter`

The redaction-bearing filter pipeline that turns raw tool output into
a ranked, byte-budgeted, summarised excerpt set. Shipped BB5
(PR #70, `ae41534`). Risk HIGH — secret-leakage failure mode.

## Pipeline (`filterOutput`, pure / no IO)

Locked order (§11b); redact runs FIRST so secrets never reach a
persistence call:

1. redact — `policy.redact(raw)` (warn if `count > 0`).
2. normalize — strip ANSI, collapse CRLF → LF, trim trailing ws
   (`src/normalize.ts`).
3. collapse repeated lines (`[repeated N times]`).
4. chunk — `chunkByLines(40)` default; specialised parsers under
   `src/parsers/` (test-output, ts-diagnostic, stacktrace) take
   precedence on format detection (`src/chunk.ts`).
5. rank — `scoreChunk(intent, chunk, sessionHints)` (`src/rank.ts`).
6. dedupe — SimHash / Hamming-distance (`src/simhash.ts`, `src/dedupe.ts`).
7. fit byte budget — greedy by descending score (`src/fit.ts`).
8. summarize — mode-dependent, deterministic, no LLM (`src/summarize.ts`).
9. compose — `bytesSaved = rawBytes - returnedBytes` (clamp 0),
   `savingRatio = bytesSaved / rawBytes` (0 when `rawBytes === 0`).

## Public surface (`packages/output-filter/src/index.ts`)

- `filterOutput` + `filterOutputInputSchema` + `FilterOutputInput` /
  `FilterOutputResult` / `OutputExcerpt` (`src/types.ts`). Input
  `mode` imports `tokenSaverModeSchema` from `@megasaver/shared`
  (§2e cycle fix); `modeToBudget` is the single mode→cap source.
- `resolveSafeReadPath(input): ResolvedPath`
  (`src/resolve-safe-read-path.ts`) — the structural sandbox gate
  (F-CRIT-2). Rejects symlink escapes, `..`-traversal, and absolute
  paths outside the project root; throws
  `OutputFilterError("path_unsafe")`. The ONLY IO-touching export;
  callers compose it with the pure `filterOutput`.
- `rankFeatureNameSchema` / `RankFeatureName` (`src/rank-features.ts`)
  — 9-member closed enum alphabetic (AA3): `diagnosticScore`,
  `duplicatePenalty`, `errorScore`, `filePathScore`, `keywordScore`,
  `noisePenalty`, `recentFileScore`, `stackTraceScore`,
  `testFailureScore`.
- `outputSourceKindSchema` / `OutputSourceKind` (`src/output-source.ts`)
  — 4-member closed enum alphabetic: `command`, `fetch`, `file`,
  `grep`. The shared source discriminator also consumed by
  `content-store` (BB4) and `stats` (BB6) — single source of truth.
- `OutputFilterError` + `outputFilterErrorCodeSchema` (`path_unsafe`,
  `validation_failed`); `RankFeatures` / `RankedChunk`.

## Boundary rules (§3c cycle guard)

- May depend on: `@megasaver/shared` + `@megasaver/policy`.
- MUST NOT depend on: `@megasaver/core` (§2e — would close a cycle
  via the shared `TokenSaverMode`). Dep-graph test enforces.

## Tests

Redaction proven by both a fast-check property test
(`redact.property.test.ts`) and a fixture corpus
(`redact-corpus.test.ts`) — one fixture per pattern name plus
secret-shaped negatives (F-MED-1).

## Related

- [[entities/policy]] — `redact` source; command/path gates.
- [[entities/content-store]] — imports `OutputSourceKind`.
- [[entities/stats]] — imports `OutputSourceKind`.
- [[concepts/context-gate-pipeline]] — the redact → chunk → rank →
  fit → summarize flow in full.
- [[entities/shared]] — `TokenSaverMode` / `modeToBudget`.

## v1.1 / post-v1.0 (2026-06-03)

**PR #92 — Language-specific parsers:**

Four new format-detect-and-parse modules added under `src/parsers/`:
`pytest`, `go` (test), `cargo` (test), `eslint`. Each is registered in
`chunkByFormat` BEFORE the generic `test-output` parser so structured
output is always preferred. The step-4 "chunk" description above remains
accurate; the new parsers are plugged in as earlier dispatch candidates.

**PR #95 — Ranker improvements:**

`scoreChunk` in `src/rank.ts` extended to match:
- CamelCase `*Error` suffixes (e.g. `TypeError`, `NetworkError`).
- The Rust/Go `panicked` signal.

Previously only lowercase `error` patterns scored in the `errorScore`
feature. Failure chunks now receive a non-zero score and are correctly
prioritised by the fit step. output-filter@1.1.0.

## v1.2 — Proxy Mode (2026-06-14)

Four of the seven phases land here. See [[concepts/proxy-mode]] for the
full arc.

- **P1 — Output classifier** (commit `c356e04`). `classifyOutput` →
  `{ category, confidence }` over `vitest | typescript | generic_shell |
  unknown`. Command-matching + output-sniffing on ANSI-stripped text;
  surfaced on `FilterOutputResult.classification`. Low confidence →
  `generic`.
- **P2 — Compressors + passthrough decision** (commit `6f65d10`).
  `compressVitest` (keep failures / assertions / stack / summary, collapse
  passing) and `compressTsc` (group-by-file, dedupe cascading diagnostics,
  top-files header). `filterOutput` `decision` band: passthrough
  (<1200 tok) / light (<2000) / compressed; the specialized compressor is
  gated on `isConfidentClassification`. Reports `rawTokens` /
  `returnedTokens` / `decision` / `compressor`; no fake savings on small
  output.
- **P4 — Engine-aware ranking** (commit `7a3c85b`). `applyEngineRanking`
  re-weights the EXISTING `scoreChunk` output (no second scorer):
  `0.70*base + 0.15*memory + 0.15*failure`, normalized to `[0,1]`, behind
  `MEGASAVER_ENGINE_RANKING` (off by default). Per-chunk `engine`
  explanation; `SessionHints.recentFailures` feeds the failure boost.
- **P6 — Replay trace** (commit `3873ae0`). With `recordTrace`,
  `filterOutput` emits a `RankingTrace`; `finalizeReplayTrace` +
  `writeReplayTrace` append JSONL best-effort, referencing the content-store
  `chunkSetId` and chunk references (scores + signals) — never raw text.
  Feeds the v1.4 ablation ladder.

## v0.6 — diff-on-reread (2026-06-25, PR #181)

Adds an `unchanged` short-circuit to the read path. `FilterOutputResult`
gained `unchanged?: { priorChunkSetId: string }` and `FilterDecision`
gained a fourth member `"unchanged-marker"` (code:
packages/output-filter/src/tokens.ts, types.ts:90). When [[context-gate]]
detects a re-read of an unchanged file it short-circuits BEFORE
`filterOutput` and returns this marker with empty excerpts instead of
re-filtering — LOSSLESS, the prior chunk-set stays expandable. output-filter
only carries the marker type + decision; the suppression mechanism (raw →
sha256 → on-disk read-index) lives in context-gate. See [[diff-on-reread]].

## v0.7 — semantic AST read (2026-06-26, PR #182)

For large **source** files, chunk production is AST-aligned instead of
naive line slices, so ranking scores coherent declarations
(functions/classes/headings/JSON keys). See [[semantic-ast-read]].

- New `src/parsers/semantic.ts`: `chunkBySemantic(text, path)` +
  `partitionFile` (code: packages/output-filter/src/parsers/semantic.ts).
  Reuses [[indexer]]'s `extractTs` / `extractMd` / `extractJson` (TS
  compiler API, already vendored — NO tree-sitter). Whole-file
  gap-filling partition (no lines dropped from ranking); blocks over 80
  lines sub-split via `chunkByLines`; NEVER throws — returns `null` to
  signal line-chunk fallback.
- Gating in `chunkByFormatWithMeta`: semantic is attempted only when
  `source.kind === "file"` with a supported ext
  (.ts/.mts/.cts/.tsx/.jsx/.js/.mjs/.cjs/.md/.json) and precedes the
  test/diagnostic parsers; null (unsupported ext, parse error, zero
  blocks) and all command/grep/fetch output fall through to
  `chunkByLines` (code: packages/output-filter/src/parsers/index.ts).
- **ASYNC**: `chunkBySemantic` / `chunkByFormatWithMeta` / `filterOutput`
  / `filterRaw` are now `Promise`-returning (types.ts:130).
- **Lazy compiler load**: [[indexer]] is imported via a cached dynamic
  `import()` inside `chunkBySemantic`, so the multi-MB `typescript`
  compiler is NOT eager-loaded on every `@megasaver/output-filter` import
  (it sits on the hot path: hooks saver → core → context-gate →
  output-filter). A guard test (`no-eager-typescript.test.ts`) asserts
  zero `typescript` modules load on import.
- New dep: `@megasaver/indexer` (cycle-safe), relaxing §3c's prior
  shared+policy-only rule for this one edge.

## ReDoS bounds on the signal regexes (2026-07-20)

Five signal-extraction patterns in this package were quadratic on long runs —
see [[concepts/unbounded-run-redos]] for the shared defect shape and the full
instance list. All five are now bounded and each is guarded independently by
`test/rank-redos.test.ts`:

| pattern | file | bound | unbounded cost |
|---------|------|-------|----------------|
| `EXCEPTION_NAME` | `src/rank.ts` | `[A-Za-z]{0,64}` | 16.1 s |
| `FILE_PATH` | `src/rank.ts` | `[\w./-]{1,256}` | 19.3 s |
| `STACKTRACE` | `src/rank.ts` | `\s{1,64}at\s{1,8}.{1,512}` | 32.9 s |
| `POSITION` | `src/normalize.ts` | `[\w./-]{0,256}` | 12.2 s |
| `SIGNATURE` | `src/parsers/stacktrace.ts` | `\s{1,64}at\s{1,8}.{1,512}\(.{1,512}` | 16.5 s |

Measured through each pattern's real call site (`scoreChunk`, `collapseSimilar`,
`detectStacktrace`) on 100 KB of the shape that drives it; bounded, the whole
20-test suite runs in ~450 ms.

Two facts a future reader will otherwise re-derive:

- **`normalize` strips trailing whitespace**, so a trailing whitespace run never
  reaches the scorer. Only a run with something after it does — the guard test's
  trailing `x` is load-bearing.
- **`POSITION` is unreachable from `scoreChunk`.** `rank.ts` never calls
  `normalize.ts`; its driver is `collapseSimilar`. An earlier guard test claimed
  to cover it and did not.

Divergence thresholds (no realistic input, but they exist): `EXCEPTION_NAME` at
65 filler chars, `POSITION` at 257, `STACKTRACE`/`SIGNATURE` past 512 body chars
and 64 indent chars. `FILE_PATH` cannot diverge at any length — its start class
equals its continuation class, so a longer run just starts the match later.
