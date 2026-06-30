# @megasaver/output-filter

## 1.2.0

### Minor Changes

- c12a575: Add per-session already-in-context dedup to the registry read pipeline.
  When `runOutputPipeline` is about to return an excerpt whose exact text
  was already shown earlier this session (recorded in a new sibling
  `shown-index.json`), the excerpt is dropped from the inline result and
  referenced via its prior chunk-set id instead — so identical text is not
  billed twice. Dedup runs after the chunk-set is persisted, so every
  suppressed excerpt remains recoverable via the referenced chunk-set
  (evidence-preserving). Adds an optional `deduped` field to
  `FilterOutputResult` and a `SHOWN_INDEX_FILENAME` constant to
  content-store (skipped when listing chunk-sets).
- c12a575: feat: per-session already-in-context dedup

  Suppress an excerpt whose exact text was already returned to the model
  earlier in the same session (any read, command, or grep) and reference the
  prior chunk-set instead, so identical text is not billed twice. New
  per-session shown-index.json sibling index; evidence stays recoverable via
  the referenced chunk-set (lossless expand).

- 8580701: feat(output-filter): diff-aware compressor for git diff/status/log

  Add a `diff` output category and `compressDiff` compressor, dispatched
  like the existing vitest/tsc compressors. For a unified diff it keeps
  every file/hunk header and every +/- changed line, reduces surrounding
  unchanged context to one line each side, and collapses fully-unchanged
  runs to a `… [N unchanged]` marker. For `git status` / `git log --stat`
  it keeps every content line — stat summaries, commit subjects (including
  ones containing a literal `|`), and `| * <sha> <subject>` graph content
  lines — and collapses only pure graph-spine runs to a `… [N graph]`
  marker. Deterministic: every collapse emits a counted marker, so distinct
  data items are never silently dropped; only redundant unchanged context
  and graph decoration are trimmed from what is RETURNED.

  The diff category is sniffed conservatively: command-less output is only
  classified `diff` when it carries a real `diff --git` header or `@@ … @@`
  hunk, so npm/console logs, markdown bullets, and ASCII pipe tables are
  not routed to this compressor.

- 46dce69: diff-on-reread (suppression-only): re-reading an unchanged file in the same
  session returns an `unchanged: { priorChunkSetId }` marker with empty
  excerpts and skips re-filtering + re-persisting. Lossless — the prior
  chunk-set is recoverable via expand. Adds FilterOutputResult.unchanged +
  unchanged-marker decision (output-filter); readRaw / filterRaw / read-index
  exports (context-gate); exports atomicWriteFile + read-index-tolerant
  listChunkSets / READ_INDEX_FILENAME (content-store).

  No @megasaver/daemon or @megasaver/mcp-bridge bump — passthrough only,
  confirmed by T11.

- ede092b: Lazy-load the TypeScript compiler out of the eager import graph. The
  semantic AST chunker imported `@megasaver/indexer` (which statically
  imports the multi-MB `typescript` compiler) at the top of
  `output-filter`, so importing `@megasaver/output-filter` — and thus
  every per-tool-call hook, the daemon, and the CLI — eagerly paid a
  multi-second compiler load on startup. The indexer is now imported
  dynamically inside `chunkBySemantic`, gated behind a supported-extension
  precheck, so `typescript` only loads when a source file is actually
  chunked.

  This makes `filterOutput` and `chunkByFormat`/`chunkByFormatWithMeta`
  (`@megasaver/output-filter`) and `filterRaw` (`@megasaver/context-gate`)
  async — they now return promises. All in-tree callers await them; the
  semantic chunker still never throws (parse error or unsupported source
  falls back to line chunking).

- b1978fa: feat: outline-first read mode

  `mega_read_file` accepts `outline: true`: for a supported source file it
  returns the file skeleton (imports + top-level signatures + line ranges +
  chunk ids) and persists every body as a fetchable chunk, so an agent expands
  only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
  falls back to a normal read for non-source / unsupported / unparseable files.

- 8b735fb: feat(output-filter): add extractive prose/markdown compressor (WS4)

  New `compressProse` function collapses prose/markdown docs extractively:
  keeps all headings, first paragraph per section, all fenced code blocks
  verbatim, short lists whole, and collapses extra paragraphs/list tails
  to counted `… [N paragraphs]` / `… [N more items]` markers.

  New `"prose"` OutputCategory with classifier sniff. Checked after
  diff/typescript/vitest/structured so it never steals those. Requires
  ATX heading as primary signal; `cat *.md` command and fetch-source
  content raise confidence independently. Deterministic, no model,
  lossless (raw persists to ChunkSet).

- 39e5eb6: Proxy Mode v1.2 Vitest + TypeScript compressors and small-output
  passthrough. `compressVitest` keeps failing tests, assertions, stack
  frames and the summary while collapsing passing tests; `compressTsc`
  groups diagnostics by file, dedupes cascading errors and leads with a
  top-files header. `filterOutput` now picks a `decision`
  (`passthrough` < 1200 tokens, `light` < 2000, else `compressed`),
  only running a specialized compressor (gated on
  `isConfidentClassification`) and budget-fitting in the compressed
  band. Thresholds are configurable; the result reports `decision`,
  `compressor`, `rawTokens` and `returnedTokens` for audit, with no fake
  positive savings on passthrough.
- 39e5eb6: Proxy Mode v1.2 narrow engine-aware ranking. `applyEngineRanking`
  re-weights the existing `scoreChunk` output (no second scorer):
  normalized base relevance plus memory and failure-history boosts,
  combined `0.70 / 0.15 / 0.15`, all signals in `[0,1]`. Gated behind
  `MEGASAVER_ENGINE_RANKING` (off by default; injectable via
  `filterOutput({ engineRanking })`). Each ranked chunk carries an
  `engine` explanation (base/memory/failure/final) surfaced on excerpts
  for audit and the v1.4 replay trace. `SessionHints.recentFailures`
  feeds the failure-history boost.
- 39e5eb6: Proxy Mode v1.2 output classifier. New `classifyOutput` returns a
  `{ category, confidence }` over `vitest | typescript | generic_shell |
unknown`, using both command matching and output sniffing on
  ANSI-stripped text. `filterOutput` now runs the classifier after ANSI
  normalization (before compressor dispatch) and surfaces the result on
  `FilterOutputResult.classification` for audit/debug.
  `isConfidentClassification` gates specialized compressor dispatch
  (P2); low-confidence output falls back to the generic filter.
- 39e5eb6: Proxy Mode v1.2 replay trace. With `recordTrace`, `filterOutput`
  emits a `trace` capturing the classification, decision, compressor,
  engine-ranking flag, token estimates, and candidate/selected/omitted
  chunk references with scores and signal values — no raw text
  (privacy §12.3). `finalizeReplayTrace` wraps it with
  session/project/tool/query and the content-store `chunkSetId` for
  offline replay; `writeReplayTrace` appends it best-effort as JSONL.
  Captures enough to drive the v1.4 ablation ladder without duplicating
  stored output.
- 5431672: Extend semantic AST chunking to Python (.py), Go (.go), and Rust (.rs)
  source reads. Three zero-dependency heuristic extractors (extractPy /
  extractGo / extractRs) detect top-level declarations (def/class; func/
  type/var(/const(; fn/struct/enum/trait/mod/impl) by line scanning and
  indentation- or brace-balanced spans — no tree-sitter, wasm, or other
  parser dependency. The chunker now produces AST-aligned chunks for those
  files instead of fixed line windows; unsupported extensions, parse
  failures, and zero-decl files fall back to line chunking as before. The
  extractors stay off output-filter's eager import graph (loaded lazily via
  @megasaver/indexer), so no per-tool-call start pays a heavier import.
- ede092b: Add semantic AST chunking for file reads. For a supported source file
  (.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs, .md, .json) the chunker now
  produces AST-aligned chunks (functions, classes, headings, JSON keys)
  instead of fixed 40-line windows, so ranking and budgeting operate on
  whole declarations. The whole file is exhaustively partitioned
  (gap-filled, oversized blocks sub-split) and a parse failure or
  unsupported extension falls back to line chunking. The command-output
  compressor and dedupe are skipped for file reads so the original file
  text is parsed and the semantic partition survives intact. Command,
  grep, and fetch sources are unchanged.
- 41751db: Add the structured-data schematizer (`compressJson`) output compressor. A
  large homogeneous JSON array (> 20 same-shape objects) is collapsed to its
  inferred schema (key list + sampled value types) plus the first 3 and last 1
  elements verbatim and a `… [N more of same shape]` marker. Keys matching the
  intent signal are force-kept in the schema. Small, heterogeneous, non-array,
  and malformed JSON fall through unchanged. Lossless — raw output is still
  persisted to the ChunkSet and recoverable via `mega_fetch_chunk`.

  Adds a `structured` member to `OutputCategory` and `CompressorName`, a `path`
  field to `ClassifyInput`, and an optional `intent` argument to
  `compressByCategory`. The structured compressor is exempt from the
  file-source semantic-chunking guard so `*.json` reads are schematized.

- 489d4ac: feat(output-filter): template-line folding (collapseSimilar)

  Add a second normalize pass that runs after `collapseRepeatedLines`. It
  masks pure identity-noise tokens (ISO/clock timestamps, uuid/hex ids,
  request-id ports) to placeholders, then folds a run of consecutive lines
  whose MASKED form is identical into one exemplar + a counted marker
  `… [N similar: <masked template>]` (N is the run length), keeping the
  FIRST and LAST concrete instance verbatim as boundary evidence. This
  catches build/install/server log spam — lines identical except a
  timestamp/id — that `collapseRepeatedLines` misses because the lines are
  not byte-identical.

  Tool-resident: runs in both the CLI saver hook and the MCP read/run tools.
  Folding only changes what is RETURNED.

  Evidence-preserving (risk HIGH): masking is deliberately narrow. Duration,
  byte-count, and decimal-number masks are intentionally NOT applied — those
  values are often the distinguishing signal (a 9000ms slow request, a
  4096 B write, a distinct account id), and the return path is the only copy
  that reaches the agent, so masking them would be non-recoverable evidence
  loss. The hex mask requires at least one hex letter so pure-decimal ids are
  never merged. A line carrying any diagnostic signal (error/fail/exception/
  warning/panic/fatal keyword, a `TS####` code, or a `file:line:col`
  position) is never folded.

### Patch Changes

- 66ac31e: fix: remove raw NUL bytes from the compressJson source

  `compress/json.ts` used a literal NUL byte as the key-set join separator, so the
  file contained raw `0x00` bytes. git and `@megasaver/indexer`'s `scanRepo`
  correctly classify any NUL-bearing file as binary and skip it, so json.ts never
  entered the index and `searchBlocks` could not return its blocks (a silent
  recall gap). The separator is now written as a unicode NUL escape sequence —
  identical NUL separator at runtime, ASCII source file. The scanner's NUL
  heuristic is correct and unchanged; a regression guard asserts every `src/*.ts`
  is NUL-free, and indexer scan tests pin that high-bit (non-NUL) UTF-8 sources
  are scanned while NUL-bearing files stay flagged binary.

- 66ae179: fix: exempt parser-detected diagnostics (eslint/pytest/go/cargo/stacktrace) from dedupe

  `chunkByFormatWithMeta` now reports a `diagnostic` flag alongside `semantic`, set
  for the parsers that emit one chunk per distinct diagnostic. `filterOutput` skips
  simhash dedupe when that flag is set, so distinct eslint problems / pytest /
  go-test / cargo-test failures / stack frames are no longer collapsed. These
  outputs classify as `generic_shell`/`unknown`, so the existing
  `DIAGNOSTIC_CATEGORIES` (keyed on classification) could not reach them. vitest /
  generic test-output stay deduped.

- 42207dd: Never blind the model on zero excerpts. A specialized compressor could empty its
  input (misclassified output whose pattern never matches, e.g. grep results flagged
  as typescript), or every chunk could exceed the byte budget — both returned zero
  excerpts, leaving the model only a "0 kept" summary. `filterOutput` now applies a
  no-blind floor: when the compressed path yields no excerpts it re-chunks the
  normalized (uncompressed) output generically and keeps the top-ranked content
  within budget, truncating the single top chunk when even one chunk overflows.
  `fitBudget` keeps its byte-budget semantics; the floor lives in the pipeline.
- 3b1cf6e: fix(output-filter): outline read falls back when skeleton would not save context

  `mega_read_file { outline: true }` now only returns the skeleton when it is
  meaningfully smaller than the raw file (skeleton bytes < 0.9 × raw bytes). On
  tiny or dense/minified files the signature skeleton can equal or exceed the
  raw bytes; in that case the read falls through to the normal rank/fit pipeline
  instead of returning a payload larger than a plain read. Lossless either way.

- 3a6ed28: semantic AST chunker: drop pure-whitespace gap chunks from the partition. Blank
  separators between declarations no longer become empty excerpts that pollute the
  ranked output (in a 40-function sample, 51 excerpts → 12, all non-empty).
  Function blocks and content gaps are unaffected; every non-blank line stays
  covered by exactly one chunk.
- 01c10f0: Four token-saver benchmark fixes for the output filter:

  - **Timestamp folding**: bare wall-clock `HH:MM:SS` is now masked to `<ts>`, and
    the position guard is scoped to a real `file:line:col` (path token followed by
    `:line:col`) so a masked timestamp's `T`-separator can no longer masquerade as
    a source position. Guards run on the masked template, letting volatile-only
    log lines collapse while structural evidence is preserved.
  - **Diff markers**: a trailing newline is treated as a line terminator, not a
    context line, so the empty tail element no longer inflates the
    `[N unchanged]` collapsed-context count by one.
  - **Diagnostic dedupe**: diagnostic-class outputs (typescript, eslint,
    stacktrace, pytest, go_test, cargo_test) are exempt from simhash dedupe —
    each `error TSxxxx` is distinct evidence — while vitest/test stays deduped
    since its compressor already folds duplicate failures.
  - **Intent pinning**: an exact intent-token hit gets a decisive score bump and
    the single best exact-intent match is pinned in `fitBudget` so budget
    pressure can never starve the declaration the read was for (still yields to
    the hard byte budget if it alone overflows).

- Updated dependencies [7fcd881]
- Updated dependencies [a3306ec]
- Updated dependencies [0a3256b]
- Updated dependencies [b2e39cd]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [5431672]
- Updated dependencies [14868ee]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/indexer@0.2.0
  - @megasaver/policy@1.2.0

## 1.1.0

### Minor Changes

- 7b978d3: Add four format-aware output parsers: pytest, go test, cargo test, and eslint.

  The format-aware chunker (`chunkByFormat`) now recognizes these tool outputs and
  chunks them by failure boundary instead of by fixed line windows, so failing
  tests and their tracebacks/assertions/panics rank above passing-run noise.
  Each parser ships a `detectX`/`parseX` pair wired into `chunkByFormat` ahead of
  the generic test-output detector (framework outputs are themselves test output;
  ordering most-specific to least keeps each fixture routed to its own parser).
  Public API is unchanged — the new parsers are reached only through
  `chunkByFormat`.

### Patch Changes

- 19def67: Broaden the output-filter ranker's failure markers so Phase-3a parser chunks
  score correctly. The ERROR signal now matches CamelCase exception names
  (`ZeroDivisionError`, `AssertionError`, `TypeError`, `ParseError`) via a
  case-sensitive `[A-Z][A-Za-z]*Error\b` arm, and the panic signal matches
  Rust's `panicked` (`\bpanic(ked)?\b`). Previously a pytest `ZeroDivisionError`
  traceback or a Rust `panicked … ParseError` block scored as low as 1 (file
  path only) while its summary line scored ~9, so failures under-ranked
  passing-run noise. Lowercase `error` keeps its existing `\berror\b/i`
  precision, so benign prose like "error handling is configurable" is not
  over-boosted.
- Updated dependencies [bb3d179]
  - @megasaver/policy@1.1.0

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- ae41534: Add the `@megasaver/output-filter` package: an evidence-preserving
  output filter pipeline (normalize, chunk, dedupe via SimHash, rank,
  summarize, fit-to-budget) plus a `resolveSafeReadPath` sandbox gate.
  Parsers for stack traces, test output, and TS diagnostics keep the
  high-signal evidence agents need while dropping noise, so we cut
  tokens without blinding the model. Public surface re-exported from
  `index.ts` with a closed `outputFilterErrorCodeSchema` enum.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/policy@1.0.0
