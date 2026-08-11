# @megasaver/output-filter

## 1.7.0

### Minor Changes

- 83202e0: Token measurement on the saver hot path has a real bound. The 500 ms race in
  `record-output` could never fire: `encode` is synchronous after memoization, so
  the timer callback waited on the work it was meant to interrupt. Measured on
  the shipped code, all with the budget silent — 8,000 characters of Japanese
  prose took 24,267 ms, 32 KB of newlines 46,218 ms, and `"a"` followed by 50,000
  spaces 114,331 ms. The PostToolUse saver runs on every tool call, so a padded
  file or a cleared progress area hung the agent for tens of seconds per counter,
  twice per event, after which the hook emitted nothing and the output passed
  through uncompressed. All four now decline in ≤1 ms.

  `countTokens` returns `number | null`; `null` means declined, never zero and
  never an estimate. It reads the encoder's own split pattern from
  `encoding.patStr` rather than restating it, and declines when
  `SUM over matches of (MATCH_OVERHEAD_BYTES + bytes) * bytes` exceeds
  `MAX_WORK_UNITS`. The sum is per match rather than a global maximum times a
  global total: the latter lets one outlier poison the document around it, and
  50 KB of clean log with a single 800-byte base64 line scored 22.7x the budget
  under that form though it encodes in 31.8 ms. Both terms are load-bearing —
  without the per-match floor, high-match-count input is admitted far past
  budget; without counting whitespace matches, 32 KB of newlines scores zero
  work, because cl100k matches a whitespace run as one match. Nothing is chunked,
  so a returned count is the encoder's own output — exact, not approximate. The
  new `tokenWorkUnits` export makes the decline decision assertable directly
  instead of through a stopwatch. `longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE`
  are gone.

  Overlay events gain an optional `tokenCountOutcome` of `"declined"`,
  `"load-timeout"` or `"failed"`. Absence still means the count succeeded.
  Without it all three were byte-identical downstream, so a tokenizer that
  started throwing would have read as nothing more than a workload of large
  outputs — and a load timeout, which is environmental, would have been filed as
  a tokenizer bug.

  `MAX_WORK_UNITS` is derived against a **loaded** machine, not an idle one: the
  1500 ms per-tool-call ceiling divided by 4.3x measured contention, minus the
  lazy `getEncoding` load and the guard's own scans, which sit inside the awaited
  path and had previously gone uncounted. The work bound is exact and
  deterministic; the wall-clock bound follows from it only up to ~4x contention,
  and past that the fixed costs alone exceed the ceiling, so no work budget could
  hold it. That limit is stated rather than implied.

  Coverage on ordinary content: 186 KB of minified JSON, 141 KB of logs, 134 KB
  of prose, 121 KB of TypeScript, 63 KB of wrapped base64, 30 KB of punctuated
  Japanese, 240 KB of one-byte-match input — while a payload that is mostly long
  rules is admitted only to about 1 KB. Mixed content is measured on its own
  merits: a 50 KB log containing one 800-byte line is counted, not refused for
  it. A declined row omits all three token fields; `mega audit honest` already
  reports the resulting coverage, though `honest-metrics` then substitutes a
  bytes/4 estimate that is +19.3% wrong on JSON, so declines are visible but not
  free.

  `TOKEN_COUNT_BUDGET_MS` is renamed `ENCODING_LOAD_BUDGET_MS`, keeping its
  500 ms value and now bounding only the lazy encoding load, which really is
  async. `@megasaver/bench-replay`'s `TokenCounters.count` widens accordingly and
  `TokenDivergenceReport` gains `excludedCorpora`, so a declined corpus is named
  rather than silently dropped from the divergence figure.

  Note for anyone comparing across the upgrade: rows written before this change
  with a long unbroken run were chunked and biased slightly upward, while the
  same shapes are now exact-or-absent, so an aggregation window straddling the
  deploy mixes two measurement regimes.

- 07a4e3d: fix: apply the secret-path denylist to the symlink-resolved read target

  The two-gate read matched `SECRET_PATH_PATTERNS` against the caller's literal
  path (`normalizePath` is a pure string op — no filesystem access) but read
  through `fs.readFile`, which follows symlinks. Gate 2 (`resolveSafeReadPath`)
  computed a realpath only to test sandbox _containment_ against
  `[projectRoot, cwd, homedir()]` and then returned the un-resolved lexical path,
  so the denylist was never applied to the file actually opened.

  Before: with `ln -s ~/.aws cfg` checked into a repo, `proxy_read_file({path:
"cfg/credentials"})` returned `{ok: true}` and the credential file's contents;
  `ln -s ~/.ssh keys` + `keys/config` returned the whole ssh config in cleartext
  with 0 redactions. No `blocked-read` firewall event was recorded, because the
  deny branch never fired. Control reads of the same bytes via
  `<home>/.aws/credentials` correctly returned `path_denied` /
  `secret_path_read`.

  After: all three shapes (directory symlink, plain file symlink, direct path)
  return `{ok: false, code: "path_denied", reason: "secret_path_read"}` on both
  `runTwoGates` and `runOverlayTwoGates`, so the firewall ledger records them.
  Ordinary in-sandbox reads are unaffected.

  `resolveSafeReadPath` now returns the realpath it already computed as
  `real` alongside `absolute` (additive field on the exported `ResolvedPath`).

### Patch Changes

- 07a4e3d: Bound the leading-indent runs in `classify.ts`'s `VITEST_OUT` and
  `PROSE_ANTI_VI`, which were quadratic on a blank-line block. Sixth instance of
  the unbounded-run class already fixed in `rank.ts`, `normalize.ts` and
  `parsers/stacktrace.ts`, with a driver of its own: these patterns open three
  (resp. two) alternatives with `^\s*` under the `m` flag, and `\s` matches `\n`,
  so inside a run of blank lines every line start consumes the whole remaining
  whitespace region before failing the required literal — O(starts x length).

  Measured through the real call site, `classifyOutput` on 100 KB of newlines:
  31.8 s before, 89 ms after. It is quadratic, so smaller inputs still hurt —
  1.7 s at 25 KB, 6.6 s at 50 KB.

  `classifyOutput` is a public export and only normalizes; it does not collapse.
  `mega bench` (`apps/cli/src/commands/bench.ts`) hands it raw command output, so
  a benchmarked command emitting a padded log tail, a truncated stream or blank
  separators hung for tens of seconds. The `filterOutput` path was shielded only
  incidentally, by feeding post-`collapseRepeatedLines` text.

  Both bounds are load-bearing and both were needed: the prose check runs on text
  that already got past the vitest check, so on the same input, reverting either
  one alone takes the new 100 KB regression test to 32.6 s / 20.9 s.

  The bound costs no reach. Under `m`, `^` re-anchors at every line, so an indent
  match that spanned a newline was already reachable from the later line start —
  behavior can only diverge on 65+ whitespace characters preceding
  `Test Files` / `Tests` / `FAIL` / `PASS` on one physical line. Real vitest
  reporters indent those by 1-6.

- 07a4e3d: Gate the `dedupe()` regression guard on a growth ratio instead of a wall-clock
  ceiling.

  The guard shipped with a 5 s ceiling at 128k lines and claimed the reverted
  all-pairs scan cost 13.5 s (its changeset said 17.4 s — the two never agreed).
  Reproduced on the machine that produced both numbers, node v25.8.2, reverting
  `dedupe()` measures 6.8 / 6.9 / 7.7 s: a 1.4x margin, not the 2.7x claimed. A
  machine ~1.5x faster, or a cheaper BigInt path in a future Node, greens the
  guard with the quadratic scan restored — the exact silent-green failure the
  ceiling existed to prevent.

  The guard now samples `filterOutput` at 64k and 128k lines and fails above
  2.75x growth. Nothing in that constant is tuned to a machine: the all-pairs
  scan is quadratic in chunk count so doubling the input costs it ~4x, while the
  banded lookup is linear and costs ~2x, and load moves both samples together.
  Measured: 1.95-2.09x idle and 2.06-2.17x under four busy cores with the fix in
  place, 4.48x with it reverted.

  Each side's minimum is taken across 3 trials before dividing, rather than
  minimising the per-trial ratio. Noise can only inflate a duration, so a
  per-side minimum converges on the noise-free cost; minimising the ratio instead
  pairs an inflated 64k sample with a clean 128k one and biases the result down —
  that form read 2.55 with the defect restored where this one reads 4.48.

- b808902: Add `retry: 3` to the dedupe growth-ratio guard, which was the only timing guard
  in the repo without it.

  It went red once on ubuntu-latest at `3.178` against a `2.75` threshold, on a
  DOCS-ONLY PR (#305), while windows-latest passed the same commit.

  The threshold, trial count, and sizes are unchanged. Re-measured through the
  guard's own harness (node v25.8.2, 10 cores, 5 repeats): linear reads 1.999-2.024
  idle and 1.838-2.104 at 2x core oversubscription — uniform load does not move the
  ratio, both samples inflate together — while a restored all-pairs scan reads
  3.916-3.992 at ~18 s per full sample.

  The retry cannot mask the defect, and that is verified rather than argued: with
  the all-pairs scan restored AND the retry active, the guard failed on all four
  attempts (3.929 / 3.897 / 3.831 / 3.885) — the lowest still 1.39x the threshold.

  Deliberately NOT converted to a wall-clock ceiling. This guard shipped with a 5 s
  ceiling and was moved off it two commits ago with measurements showing only a
  1.4x margin to the reverted cost — a faster machine or a cheaper BigInt path
  would green it with the quadratic restored. That silent-green failure is worse
  than a visible flake.

  The 3.178 itself is NOT diagnosed: CPU contention is ruled out, and the remaining
  hypotheses (memory pressure on a 2-core runner, or interference spanning the
  whole measurement window, which `min`-of-3 cannot filter) are unconfirmed. This
  is a bounded, documented mitigation, not a root-cause fix.

- 07a4e3d: Replace `dedupe()`'s all-pairs simhash scan with a pigeonhole-banded lookup.

  Every chunk was compared against every kept hash with a 64-iteration BigInt
  Hamming loop, and nothing caps chunk count ahead of it: the read path reads a
  file whole and the saver hook passes its payload straight in, at 40 lines per
  chunk. High-entropy output (build logs, CSV, hex dumps) has no duplicates, so
  every chunk survives and the scan runs at full length while folding nothing.
  The MCP tool call / PostToolUse hook blocks for the whole time.

  The 64-bit simhash is now split into `HAMMING_DEDUPE_THRESHOLD + 1` bands of 16
  bits. Two hashes within the threshold must share a whole band, so only
  band-mates need a Hamming compare. The kept set is unchanged — a test pins it
  against a brute-force all-pairs reference on a corpus with real folds.

  Measured through `filterOutput` on 128k lines (1.1 MB) of high-entropy output,
  3,200 chunks, node v25.8.2: **6.8-7.7 s before, 0.32 s after** (the rest of the
  pipeline alone is 0.13 s).

- 07a4e3d: Bound the five remaining `^\s*`/`^\s+`-under-`m` leading runs in this package:
  `TEST_FAILURE` (`rank.ts`), `FAIL_LINE` (`parsers/go-test.ts`), `SUMMARY` and
  `PROBLEM_ROW` (`parsers/eslint.ts`), and `SIGNATURE` (`parsers/test-output.ts`).
  Seventh instance of the unbounded-run class, and the siblings the sixth fix
  missed — that one bounded `classify.ts`'s two copies of this exact shape and
  stopped one file short.

  The driver is a run of U+2028 LINE SEPARATOR (U+2029 is identical). Under `m`,
  `^` anchors after every U+2028 **and** `\s` matches it, so each of these
  patterns rescans the whole remaining run from every one of those anchors —
  O(starts x length).

  The pipeline's pre-filter does not shield them: `normalize` splits on `\n` only
  and `collapseRepeatedLines` folds identical `\n`-lines, so the run arrives as a
  single logical line with every anchor intact. `readRaw`
  (`packages/context-gate/src/read.ts`) reads a file whole with no size cap and
  hands it to `filterRaw` → `filterOutput`, so one file read carries the whole
  cost. A plain `\n` run folds to a marker and a space/tab run leaves a single
  anchor — neither fires, which makes U+2028/U+2029 crafted input rather than the
  accidental shapes behind instances 6 and 7.

  Measured through the real call sites at 200 KB, one bound reverted at a time
  with the other four in place: 30.5 s (`detectGoTest`), 29.9 s (`detectEslint`,
  `SUMMARY`), 30.0 s (`detectEslint`, `PROBLEM_ROW`), 30.7 s
  (`detectTestOutput`), 33.5 s (`scoreChunk`) — so every bound is individually
  load-bearing. All five bounded, the 28-test regression file runs in 200 ms.
  Quadratic, so smaller inputs still hurt — 0.5 s at 25 KB, 1.9 s at 50 KB,
  7.6 s at 100 KB.

  Isolating `PROBLEM_ROW` takes care: `detectEslint` is
  `SUMMARY.test(text) && PROBLEM_ROW.test(text)`, so on a bare run `SUMMARY`
  fails and short-circuits before `PROBLEM_ROW` is evaluated. The guard prefixes
  a real `✖ 3 problems` line so the `&&` reaches the second pattern.

  Bounding the leading run is also what defuses `PROBLEM_ROW`'s second `\s+`: a
  start position must now sit within 64 characters of the `\d+:\d+`, so only
  O(64) starts can reach any one gap.

  The bounds cost no reach. Under `m`, `^` re-anchors at every line, so an indent
  match that spanned a line terminator was already reachable from the later
  anchor; behavior can only diverge past 64 leading whitespace characters on one
  physical line. Real go, eslint and vitest reporters indent by 1-6.

- 07a4e3d: Replace `normalize`'s per-line trailing-whitespace strip `/\s+$/` with
  `String.prototype.trimEnd()`. Sixth instance of the unbounded-run class already
  documented in `wiki/concepts/unbounded-run-redos.md`, and the earliest one in
  the pipeline: `normalize` is the first structural pass over every raw tool
  output and file read, ahead of any size cap.

  `\s+$` is an unbounded greedy run followed by a required (zero-width) anchor,
  retried at every start position. On a whitespace run that is _not_ at
  end-of-line — a padded table row, an ASCII banner, a tab-indented blob, a
  whitespace-padded minified file — each of the N offsets inside the run consumes
  to the run's end, fails `$`, and backtracks the whole run: O(N^2) in line
  length. A run that _is_ at end-of-line matches on the second start position and
  is linear, which is why the defect survived the existing corpus.

  Measured through the public `classifyOutput({ text })`, which calls `normalize`
  first, on `'a' + fill.repeat(n - 2) + 'b'`:

  | input            | before    | after |
  | ---------------- | --------- | ----- |
  | 100 KB space run | 3,208 ms  | <1 ms |
  | 100 KB tab run   | 3,977 ms  | <1 ms |
  | 200 KB space run | 13,846 ms | <1 ms |
  | 200 KB tab run   | 17,046 ms | <1 ms |

  Roughly 4x per doubling confirms the quadratic. A same-byte-count control that
  wraps the identical whitespace at 80 columns measured 3.2 / 9.5 / 12.3 / 17.1 ms
  at 25 / 50 / 100 / 200 KB against the single-line run's 1,329 / 6,958 / 8,614 /
  23,122 ms, so the cost was the regex shape and not the byte count.

  `trimEnd` is exactly equivalent, not an approximation: ES `\s` is defined as
  WhiteSpace plus LineTerminator, which is the identical set `trimEnd` removes,
  and `$` without the `m` flag anchors only at end of string — the same maximal
  trailing run. A regression test pins the exotic members of that set (vertical
  tab, form feed, NBSP, BOM).

  The regression guard runs at 200 KB rather than the suite's shared 100 KB. Each
  backtrack step here is a bare anchor check, cheaper per step than the
  class/literal patterns already guarded, so at 100 KB the unbounded form stayed
  under the shared 5 s ceiling. Both new cases were verified to fail on their own
  when the fix is reverted (33.6 s / 29.6 s against a 5 s ceiling).

- d26c4ec: Five evidence-honesty repairs from the 2026-07-31 audit. (1) All counted
  evidence markers (prose/json/vitest/tsc/diff, not just normalize's two forms)
  are reserved ahead of score in `fitBudget` via a shared `EVIDENCE_MARKER`
  grammar, so count evidence can no longer vanish under budget pressure.
  (2) `dedupe()` runs only in the compressed band — passthrough/light bands
  really do keep every chunk — and its folds are counted in `droppedCount`.
  (3) Within a near-duplicate cluster the highest-scored member survives
  (ties → earlier), so a later error-bearing duplicate no longer loses to an
  earlier boring line. (4) The outline branch counts its own summary into
  `returnedBytes`/`returnedTokens` (M13). (5) `parseGoTest` reports what it
  omits — passing blocks and preamble produce a counted, non-droppable marker
  chunk and feed `droppedCount` — instead of dropping them silently.
- 07a4e3d: Collapse the trailing `\s+` in pytest's `FAILURE_HEADER` to a single `\s`. Ninth
  instance of the unbounded-run class documented in
  `wiki/concepts/unbounded-run-redos.md`, and the first with no bound to revert —
  the cost comes from an ambiguity between adjacent quantifiers, not from an
  unbounded class.

  `/^_+\s+\S.*\s+_+$/` lets `.*` and the `\s+` behind it compete for the same
  whitespace, and the `_+$` they hand off to cannot succeed on a line ending in
  anything else. Every split point of `.*` inside a whitespace run therefore
  rescans that whole run: O(N^2) in line length.

  The gate is what makes it reachable. `detectPytest` is the **first** dispatch in
  `chunkByFormatWithMeta` and fires on any text containing a `=== FAILURES ===`
  line, so one padded line anywhere in a tool output or a read file routes every
  remaining line of that text through the header pattern. Nothing upstream caps
  size, and the vitest compressor that runs earlier leaves the line intact.

  Measured in `parsePytest`'s per-line loop on `'_ x' + ' '.repeat(n) + 'y'`:

  | input  | before      | after  |
  | ------ | ----------- | ------ |
  | 25 KB  | 247.6 ms    | 0.1 ms |
  | 50 KB  | 979.1 ms    | 0.1 ms |
  | 100 KB | 3,899.0 ms  | 0.1 ms |
  | 200 KB | 16,152.9 ms | 0.2 ms |

  ~4x per doubling confirms the quadratic. Through `chunkByFormatWithMeta` at
  200 KB: 18,805 ms → 3 ms. The interior underscore run in the original report is
  not the driver — the pure whitespace shape above is the worst case; a long
  underscore run with no whitespace costs 0.27 ms at 100 KB and a real
  `___ test_broken ___` header 0.07 ms.

  `\s` accepts exactly the same lines as `\s+` here, because `.*` already absorbs
  any extra whitespace ahead of it: 0 mismatches over 400k random strings drawn
  from `_`, space, tab, `x`, `.`, `y`, and identical verdicts on real pytest
  headers, parameterised headers and near-miss shapes (`_ x_`, `_x _`, `_ _`,
  `___ test_a ___ trailing`).

  The regression guard runs at 200 KB rather than the suite's shared 100 KB: each
  backtrack step here is a whitespace rescan with no class test, so once JIT-warm
  the ambiguous form measured 5.0 s at 100 KB — level with the shared 5 s ceiling.
  It was verified to fail on its own with the fix reverted (18,805 ms against the
  5 s ceiling).

- 4ddac04: Bound five signal-extraction regexes that were quadratic on long runs.
  `EXCEPTION_NAME`, `FILE_PATH` and `STACKTRACE` in `rank.ts`, `POSITION` in
  `normalize.ts` and `SIGNATURE` in `parsers/stacktrace.ts` each paired an
  unbounded greedy run with a required trailing literal, so on a long run of
  characters the run's class accepts but the literal never follows, every position
  started a scan to end-of-input and then backtracked — O(starts x length).

  `STACKTRACE` and `SIGNATURE` have a second driver on top of that: `\s+` and `.+`
  both accept whitespace, so the split between them is ambiguous at every offset
  of a long whitespace run, and `SIGNATURE`'s two `.+` runs are ambiguous again on
  a paren-dense line.

  Measured through each pattern's real call site on 100 KB of the input shape that
  drives it, unbounded: `EXCEPTION_NAME` 16.1 s, `FILE_PATH` 19.3 s, `POSITION`
  12.2 s, `SIGNATURE` 16.5 s, `STACKTRACE` 32.9 s. Bounded, the whole regression
  suite covering all five runs in ~450 ms.

  This is reachable from ordinary tool output, not only crafted input: base64
  blobs, minified bundles and hex dumps are long delimiter-free runs, column-
  padded tables and tab-indented logs are long whitespace runs, and this pipeline
  ingests arbitrary command output with no size cap ahead of it. It contributed to
  `apps/cli`'s `saver-run` suite timing out a test, which left `main` red.

  No realistic input changes behavior, but the bounds are not free, so here is
  exactly where each one bites:

  - `EXCEPTION_NAME` diverges at 65 filler chars (`A` + 65 lowercase + `Error`).
    It cannot diverge if the filler contains an uppercase letter — any `[A-Z]`
    restarts the match.
  - `POSITION` diverges at 257 filler chars drawn from `[\w./-]` but not
    `[A-Za-z]` (e.g. `-`). Alphanumeric filler cannot diverge, for the same
    restart reason.
  - `FILE_PATH` cannot diverge at any length: its start class equals its
    continuation class, so a longer run simply starts the match later.
  - `STACKTRACE` and `SIGNATURE` diverge past 512 body chars, and `STACKTRACE`
    past 64 indent chars. These two are `^`-anchored, so they have no restart
    escape. Verified equivalent on 20 real frames first: node with and without
    parens, tab-indented, deep monorepo, nested v8 eval, java, python, go, rust.

  The bounds are load-bearing — restoring `*` or `+` restores the quadratic, and
  the regression suite now fails on each one individually.

  Correction to the original report: the `saver-run` baseline was first quoted as
  236 s. That figure was captured under `turbo test` with ~12 packages in
  parallel; on an idle machine the same suite measures 160 s. The red-to-green
  result and the 50.8 s fixed figure reproduce as stated.

- 07a4e3d: Write the store owner-only (dirs 0700, files 0600). Everything MegaSaver
  persists was created with process-default permissions — 0644 files inside 0755
  directories — so on a shared box every other local account could read it with
  `cat` (CWE-732).

  The exposed data is the sensitive half of the product: an `OverlayChunkSet`
  holds the verbatim body of every file the agent read and the full transcript of
  every command it ran (redacted only for known secret shapes), and
  `stats/<wk>/session-intent.json` holds the user's verbatim prompt. Both are
  written on the default install path — the `mega hooks install` UserPromptSubmit
  and PostToolUse hooks — with no exploit step beyond `ls -l`.

  Measured on a fresh `HOME` through the real hook entry point
  (`… | mega hooks intent`), before → after:

  ```
  drwxr-xr-x  <HOME>/.local/share/megasaver           drwx------
  drwxr-xr-x  …/megasaver/stats/<wk>                  drwx------
  -rw-r--r--  …/<wk>/session-intent.json              -rw-------
  -rw-r--r--  …/<wk>/intent/sess1.json                -rw-------
  ```

  and through `mega output file <session> big.txt --intent …`, every one of
  `content/<proj>/<sess>/{<chunkSetId>,read-index,shown-index}.json`,
  `stats/<proj>/<sess>{.json,.events.jsonl}` and
  `stats/<proj>/<sess>-traces/replay-traces.jsonl` moved from `-rw-r--r--` to
  `-rw-------`, with every containing directory from `drwxr-xr-x` to `drwx------`.

  Fixed at the writers rather than at one directory, matching the convention the
  already-hardened siblings use (`daemon/discovery.ts`, `llm-proxy/store.ts`,
  `context-gate/saver-store.ts`): the three `atomicWriteFile` helpers
  (content-store, stats, evidence-ledger), the seven stats JSONL appenders (now
  routed through one `appendPrivateLine`), `writeReplayTrace`, the CLI intent
  hook's `writeIntentAt`, and `initStore` for the store root itself.

  Each site pairs the create-time `mode` with an explicit `chmod`, which is what
  actually repairs an existing install: `mkdir`'s mode is a no-op on a directory
  that already exists and `appendFileSync`'s is ignored once the file exists. That
  gap is why the hardened writers were being defeated in practice — an unhardened
  writer usually created `stats/` first, leaving `saver-hook-heartbeats.json`
  (0600) sitting in a 0755 directory. On the next write, an old store now heals
  itself.

  Windows is unaffected (NTFS ignores POSIX mode bits); the permission assertions
  skip there.

- 9d46944: `countTokens` no longer stalls on highly repetitive input. js-tiktoken's
  `encode` degrades on long runs of _repeated_ characters, not on run length as
  such — measured on this machine: 60 KB of unbroken hex 9 ms, 64 KB of
  space-free JSON 33 ms, `"X".repeat(50000)` **90,790 ms**. `countTokens` now
  scans for the longest whitespace-delimited run and, only past `MAX_SAFE_RUN`
  (2000 chars), encodes in 1000-char chunks; ordinary text takes the whole-string
  path unchanged. Chunking costs accuracy at the boundaries, measured against
  whole-string counts as 0.00% on code, 0.00% on prose, 0.20% on JSON and 0.05%
  on base64. That error is **not** neutral: `rawTokens` is the larger text and so
  the one that chunks, while the smaller `returnedTokens` usually does not, which
  biases `deltaTokens` upward — the guard inflates reported savings rather than
  understating them. The saver's own end-to-end suite went from 467 s to 12.0 s.
- Updated dependencies [07a4e3d]
- Updated dependencies [193e757]
- Updated dependencies [ab4d04c]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [20bf90d]
- Updated dependencies [1ecbaef]
- Updated dependencies [25b23b8]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [ddd86a7]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
  - @megasaver/indexer@0.2.3
  - @megasaver/policy@2.0.0
  - @megasaver/evidence-ledger@0.2.3
  - @megasaver/shared@1.3.1

## 1.6.0

### Minor Changes

- eb74c35: Code-Truth Verify (i6): git-anchored memories that stale and heal.

  - core: `memory-anchor` module (codeAnchor/lastVerified schemas, best-effort
    `captureCodeAnchor`), `code-truth` module (pure `verifyAnchors` planner +
    `runVerify` git runner), whole-batch `applyMemoryEntryPatches`, and
    `STALE_WEIGHT` down-ranking for stale rows on includeStale surfaces.
    Contradiction closes `validTo` with ownership tracking
    (`closedByCodeTruth`); heal reopens only code-truth-owned closes. Anchor
    paths reject control characters at the schema boundary.
  - output-filter: public `extractBlocksForFile` polyglot per-file extraction.
  - cli: `mega memory verify` (free one-shot; `--install-hook` /
    `--uninstall-hook` Pro post-commit automation), `--symbol` inputs,
    `--no-anchor` opt-out, sweep verify pre-pass (Pro), show/explain anchor
    summary + verification badge.
  - mcp-bridge: `save_memory` symbol anchors, `get_relevant_memories`
    verification badges + Pro pre-recall spot-check with sentinel-guarded
    disclosure, new `verify_memories` tool (Pro).
  - stats/entitlement: `code-truth` ProFeature key, stale-recall-avoided ledger
    and "stale recall waste avoided" savings line.

## 1.5.0

### Minor Changes

- 815445a: Saver eligibility + ranking wave 3: the hook's byte gate is now the single
  compression-eligibility authority (no more 4–8 KB dead band), safe mode
  compresses Bash below Claude Code's output ceiling, file reads get semantic
  AST chunking, compressed views render in source order with `… [lines A-B
omitted]` markers, intent is per-session with a 30-minute TTL, the intent
  tokenizer understands non-ASCII prompts, and a committed
  `.megasaver/policy.json` can floor the mode a repo may be compressed with.
- 3905c30: Saver recovery wave 2: hook-compressed output is now stored as uniform
  40-line chunks — the recovery footer advertises `N chunks` with fetch-by-id
  (`i = 0..N-1`) so an agent expands only the slice it needs instead of
  re-paying for the whole raw. The content
  store self-cleans: `pruneOlderThan` now recognizes overlay chunk sets (they
  previously leaked forever), removes emptied directories, runs best-effort
  from the saver hook at most once a day (30-day retention), and is available
  manually as `mega output gc [--days N]`.

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0
  - @megasaver/evidence-ledger@0.2.2
  - @megasaver/indexer@0.2.2
  - @megasaver/policy@1.2.2

## 1.4.0

### Minor Changes

- 20977aa: Decision-Trace Viewer: surface the causal chain behind each context decision.

  Registry/proxy outputs now record their ranking decision inline on the replay
  trace — the classification, the selected/omitted chunks with their EngineScore
  breakdown, the memory ids that boosted the ranking (`rankedByMemoryIds`), and the
  redaction summary. Replay tracing is now **on by default** (disable with
  `MEGASAVER_SEAM_TRACE=false`), bounded by a retention cap on trace-session dirs.

  - New `readSessionDecisionTrace` reader joins the trace's inline attribution into
    a per-output `SessionDecisionTrace` (output granularity).
  - New CLI: `mega trace explain <sessionId> --project <name> [--workspace <key>]
[--json]` renders the causal chain for a registry session.
  - New GUI: a Cytoscape decision-flow panel with a project-scoped session picker
    (traces come from proxy/registry sessions for the workspace).

  Note: the memory attribution is _ranking-causal_ (which memory boosted the
  output's ranking), distinct from the evidence ledger's retention `pinnedByMemoryIds`.
  `highRiskFindings` is the seam's redaction count. Traces exist only for
  registry/proxy sessions; pure cockpit/overlay sessions show an honest empty state.

## 1.3.0

### Minor Changes

- 4269f42: Live Context Seam phase 2: harden failure capture, feed failures back through
  every read path, and make the seam observable and switchable end to end.

  - `@megasaver/context-gate`: overlay failure store persists captured failures
    through the registry; failure-aware ranking now applies on registry read
    paths, with new memory and conventions hint sources feeding the gate.
    Hint building is best-effort per source — a corrupt store file degrades to
    a non-fatal `session hints skipped` warning instead of failing the read.
    Capture filtering skips evidence-free exit-1 runs, redacts the full raw
    output before the 4000-char evidence cap, and failure signatures are
    restricted to a code-extension allowlist so non-code noise never becomes a
    signature. Seam replay traces are recorded with an A/B switch, gated behind
    opt-in `MEGASAVER_SEAM_TRACE=true`.
  - `@megasaver/output-filter`: new kill switch resolver disables the seam per
    scope, `seamTraceEnabledByEnv` gates trace recording, and
    `readReplayTraces` exposes recorded replay traces to consumers.
  - `@megasaver/cli`: new `mega audit seam` command reports seam effectiveness
    from recorded replay traces.

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0
  - @megasaver/indexer@0.2.1
  - @megasaver/policy@1.2.1

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
