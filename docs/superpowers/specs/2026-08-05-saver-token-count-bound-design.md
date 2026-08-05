# Design Spec: Bound Token Measurement On The Saver Hot Path

> **Date:** 2026-08-05
> **Packages:** `@megasaver/output-filter`, `@megasaver/context-gate`
> (+ `@megasaver/bench-replay` as a caller)
> **Risk Level:** **HIGH** — the PostToolUse saver runs on every tool call. The
> defect blocks the agent's event loop for seconds to minutes on input the
> operator cannot predict, and the guard written to prevent it cannot fire.
> Per risk-modes §12: architect + critic in separate contexts, own worktree.
> **Spec Status:** DRAFT v2 — rewritten after v1 was REJECTED at the architect
> gate. See §9 for what v1 got wrong and why the shape of this one differs.
> **Origin:** `wiki/syntheses/verify-fresh-audit-2026-08-01.md` §"The guard
> cannot work", confirmed live 2026-08-05.

---

## 1. Problem

`record-output.ts:398` races `countTokens` against
`setTimeout(TOKEN_COUNT_BUDGET_MS)` (500 ms) and omits the token fields on
timeout. The race cannot work.

`countTokens` is `async` only for the lazy `await loadEncoding()`. After the
encoding is memoized, every `encoding.encode()` call is synchronous and the
loop never yields. Synchronous work holds the event loop, so the timer callback
cannot run until the tokenizer has already returned. **The budget bounds the
js-tiktoken load, not the encode.** No value of the constant changes this.

Measured 2026-08-05, 400 KB input, budget 500 ms, budget never fired:

| input shape | time |
|---|---|
| ordinary log text | 41 ms |
| zero-padded base64 | 2,702 ms |
| repeated character `"X"` | 14,388 ms |
| separator spam `"="` | 15,271 ms |

There is no size cap: `record-output.ts` passes the full `input.raw` to the
counter, and `COMPRESS_FLOOR_BYTES = 2048` is a minimum-to-compress floor.

## 2. What the existing chunk guard does and does not fix

`32846bfd` routes input to a chunked path when
`longestRun(text) > MAX_SAFE_RUN` (2000), where `longestRun` is the longest
**whitespace-delimited** run. This changed the shape from quadratic to linear on
the chunked path. It left the whole-string path unbounded, and that is the
live hole:

**A newline defeats it.** A horizontal rule in a real log is 1500 `=` followed
by `\n`. That drops `longestRun` to 1500, under the threshold, so the input
takes the **whole-string** path. Verified independently:

| `("=" × 1500 + LF)` | longestRun | route | time |
|---|---|---|---|
| 50,000 chars | 1500 | whole-string | 2,746 ms |
| 100,000 chars | 1500 | whole-string | 5,475 ms |
| 200,000 chars | 1500 | whole-string | 10,924 ms |

The shapes §1 names as production exposure — horizontal rules, progress-bar
spam, separator spam — are newline-terminated in real output, so they land on
the *less* guarded path. Any guard built on a whole-string routing boolean has
this hole, because one run's length decides the treatment of the entire input.

## 3. The cost and accuracy models

### 3.1 Cost is driven by run length, but only for mergeable content

Per-character encode cost rises linearly with the length of the whitespace-free
run a character sits in (100 KB, period-16 filler, space-delimited):

| run length | 64 | 128 | 256 | 512 | 1000 | 1500 | 1999 |
|---|---|---|---|---|---|---|---|
| µs/char | 3.26 | 6.04 | 12.59 | 25.90 | 50.59 | 75.49 | 99.36 |

≈ 0.05 µs/char per unit of run length. **But run length alone does not predict
cost.** 400 KB of minified JSON is one 400,000-char run and encodes in 39 ms;
the same run length of repeated `=` takes minutes. Only *mergeable* runs are
slow. Distinguishing them requires knowing BPE merge behaviour, which is the
expensive thing being guarded against — so no cheap cost predictor exists.

**This is why the design bounds cost structurally instead of predicting it.**

### 3.2 Chunking bounds the rate for every shape

If every input is split so that no piece exceeds `CHUNK_TARGET`, then no run
*within a piece* exceeds `CHUNK_TARGET`, so by §3.1 the per-character cost is
bounded at ≈ 0.05 × `CHUNK_TARGET` µs/char **for any content whatsoever**. No
routing decision, no shape guess, nothing a newline can defeat.

Measured chunked rate at `CHUNK_TARGET = 250`, 100 KB:

| shape | µs/char |
|---|---|
| zeroed hex | 0.07 |
| prose | 0.11 |
| minified JSON | 0.11 |
| varied hex | 0.19 |
| base64 | 0.47 |
| period 2 | 7.26 |
| **period 3** | **9.00** |

Worst measured 9.00, against a structural bound of 12.5. Consistent.

### 3.3 Splitting *before* whitespace is exact for ordinary text

cl100k merges a leading space into the following word, so a piece must end
*before* a whitespace, leaving the next piece to begin with it. Drift against
whole-string, 60 KB:

| shape | target 250 | target 128 | target 64 |
|---|---|---|---|
| prose | **0.00%** | **0.00%** | **0.00%** |
| log lines | **0.00%** | **0.00%** | **0.00%** |
| typescript | 0.26% | 3.57% | 7.14% |
| varied hex | 0.00% | 0.20% | 0.39% |
| minified JSON | 0.28% | 0.55% | 1.10% |

Splitting *after* the whitespace instead costs 2.03% on prose at target 250 —
the merge direction matters and is not a detail.

### 3.4 Force-split distortion is predicted by sample chars-per-token

A run longer than the target must be force-split, and that distorts. How much
is predicted by the mergeability of the content, measurable by encoding a
**bounded 250-char sample** of the longest run (worst measured sample cost:
3.1 ms):

| shape | sample chars/token | chunk drift |
|---|---|---|
| varied hex | 1.24 | 0.0% |
| base64 | 1.40 | 0.0% |
| period 2 | 2.00 | 0.0% |
| minified JSON | 2.14 | 0.3% |
| zeroed hex | 2.98 | 0.8% |
| period 3 | 2.98 | 0.8% |
| period 1 `"X"` | 7.81 | 2.4% |
| period 8 | 7.81 | 4.8% |
| period 16 | 14.71 | 16.0% |
| `"=" × 1500` rule | 50.00 | 30.9% |

Monotone, with a clean gap between 2.98 (0.8%) and 7.81 (2.4%). The distortion
is always **upward**, and pathological content compresses to almost nothing, so
`deltaTokens ≈ rawTokens` on exactly these rows — an inflated count inflates
reported savings directly. That is the flattering direction, so these rows must
be declined rather than approximated.

Note this gate measures **accuracy, not cost**: period-2 is slow whole-string
(2,904 ms at 10 KB) yet chunks to 0.0% drift. Cost is already handled by §3.2.
The two decisions are independent and neither proxy substitutes for the other.

## 4. Design

### 4.1 Deterministic by construction

Every decision below is a pure function of the input bytes. No timer decides
whether a field is stored, so byte-identical input produces byte-identical
events on any machine (I11).

This is a property of the design, not an argument against alternatives. The
`worker_threads` option is rejected on cost alone — a multi-MB ranks load per
worker on a per-tool-call hook, which `tokens.ts:26` forbids — and v1's
additional determinism argument against it was withdrawn (§9).

### 4.2 `@megasaver/output-filter` — `tokens.ts`

`longestRun` and `MAX_SAFE_RUN` are **deleted**. There is no routing boolean.

```
countTokens(text): Promise<number | null>
  1. if text.length > MAX_MEASURABLE_CHARS        -> null   (cost)
  2. split into pieces of at most CHUNK_TARGET, ending each piece
     before a whitespace where one exists in the piece; force-split
     inside a run only when the run itself exceeds CHUNK_TARGET
  3. if any piece was force-split:
       sample = first CHUNK_TARGET chars of the longest run
       if CHUNK_TARGET / encode(sample).length > MAX_CHARS_PER_TOKEN
                                                  -> null   (accuracy)
  4. return sum of encode(piece).length
```

| constant | value | basis |
|---|---|---|
| `CHUNK_TARGET` | 250 | §3.3 — 0.00% on prose and logs, 0.26% on code |
| `MAX_CHARS_PER_TOKEN` | 3.0 | §3.4 — below it drift ≤0.8%, above it ≥2.4% |
| `MAX_MEASURABLE_CHARS` | 32_768 | §4.3 |

Steps 1 and 3 are checked before and around a bounded sample, so declined input
never pays a full encode.

### 4.3 The size cap

Two counters run per event over `raw` and `finalText`
(`record-output.ts:399`). Both are synchronous, so `Promise.all` buys no
concurrency and **they add**: the per-call budget is half the 1500 ms ceiling,
i.e. **750 ms**, not 1500.

At the §3.2 structural bound of 12.5 µs/char, 750 ms buys 60,000 chars.
`MAX_MEASURABLE_CHARS = 32_768` therefore costs at most 410 ms per call and
820 ms per event against the structural bound — **1.8× headroom** — and 295 ms
per call against the worst *measured* rate (9.00 µs/char), **2.5× headroom**.

The 1500 ms ceiling is the operator's answer to "what stall may the saver add
to one tool call". `DAEMON_TIMEOUT_MS` was cited in v1 as its source; that was
wrong (§9) — it is an abort on the daemon POST, after which the hook re-runs
everything in-process, and within each leg tokenization shares the budget with
compression, redaction, sha256 and a file lock. 1500 ms stands as the operator
directive; it is not inherited from that constant.

**This cap is conservative for typical content** and that is a real cost: prose
runs at 0.11 µs/char, so 32 KiB of it costs ~4 ms, and content above the cap is
declined anyway. Sizing for the worst case is the price of a bound that no
input shape can defeat. §8 Q1 asks whether to trade accuracy for coverage here.

### 4.4 `@megasaver/context-gate` — `record-output.ts`

- **Keep** the `Promise.race`, renamed `ENCODING_LOAD_BUDGET_MS`, comment
  corrected. It genuinely bounds the async `loadEncoding()`; it only ever
  falsely claimed to bound the encode. 500 ms stays — sized above a measured
  cold start of 101–132 ms.
- `null` from **either** counter omits all three token fields. The production
  case is asymmetric: the large `raw` is declined while the small `finalText`
  measures fine. A `null` reaching the event is not merely a wrong number —
  `packages/stats/src/event.ts:21` is `z.number().int().nonnegative().optional()`,
  which accepts `undefined` and **rejects `null`**, so the whole overlay event
  would fail validation and the row would be lost.
- A thrown error stays a separate path from a decline, so a genuine tokenizer
  fault cannot hide behind an expected condition.

### 4.5 `@megasaver/bench-replay` — `token-divergence.ts`

`TokenDivergenceReport` gains `excludedCorpora: string[]`. A declined corpus is
named, not dropped: a divergence figure must state what it did not cover.

## 5. Effect on reported numbers

`measuredTokenCoverage` and the `token source: N% measured` line already exist
and will show the decline rate. But `honest-metrics.ts:130-137` substitutes
`tokensFromBytes(e.rawBytes)` whenever the measured pair is absent, and
`tokens.ts:61-62` records that estimator as **+19.3% wrong on JSON**. So a
decline does not merely reduce coverage — it swaps a measured count for a
known-biased estimate on the largest events.

Implementation must therefore report the decline rate and the resulting shift
in the headline savings figure on a real corpus, not just assert coverage is
visible. This is a Definition-of-Done item, not a footnote.

## 6. Rejected alternatives

| alternative | why rejected |
|---|---|
| Keep a whole-string routing boolean | §2 — one newline defeats it; this killed v1 |
| Same-character-run detector | Measured: misses periods 2–16, seconds-slow at 10 KB |
| `worker_threads` offload | Multi-MB ranks load per worker on a per-tool-call hook |
| Raise `TOKEN_COUNT_BUDGET_MS` | Structurally dead; no value fixes it |
| Σ(run²) cost budget | Over-predicts on varied content — 400 KB minified JSON scores as ~8,000 s and encodes in 39 ms, so it declines exactly what §3.4 shows is safe |
| chars/token as a *cost* gate | Predicts accuracy, not cost: period-2 scores 2.00 (safe) yet is slow whole-string |
| Fall back to `estimateTokens` above a cap | Puts an estimate in a field whose contract is "measured or absent" |

## 7. Testing

**Timing assertions must measure elapsed time with `Date.now()` around the
call.** A Vitest per-test timeout cannot bound synchronous work — the critic
demonstrated a 70,621 ms call reported green under a 5,000 ms timeout. No test
in this feature may delegate a duration assertion to the framework.

**Constants must be pinned to literals**, not to themselves. An input sized
`CAP + 1` asserts only that `cap + 1 > cap` and holds at any cap value;
mirroring `tokens.test.ts:31`'s existing `expect(MAX_SAFE_RUN).toBeLessThanOrEqual(2000)`
is the pattern to follow.

**The fixture table must carry a run-length axis**, including
`"=" × 1500 + LF`, `"#" × 1900 + LF`, and period-16 at run lengths 256/1000/1999
— the shapes v1's table structurally could not represent — and must exercise
sizes both under and over `MAX_MEASURABLE_CHARS`.

Mutations that must fail, each against a named assertion:

| # | mutation | must break |
|---|---|---|
| 1 | `MAX_MEASURABLE_CHARS` → 400_000 | a literal bound assertion, plus a measured-duration assertion |
| 2 | `MAX_CHARS_PER_TOKEN` → 100 | drift assertion on the `"=" × 1500 + LF` fixture |
| 3 | `CHUNK_TARGET` → 2000 | measured-duration assertion on period-16 |
| 4 | split *after* whitespace instead of before | prose exactness assertion (0.00%) |
| 5 | remove the whitespace-terminated fixtures | a test asserting the table contains them |
| 6 | `null` → `0` in either gate | coverage assertion |
| 7 | both-null check → single-sided | asymmetric-decline test (`raw` null, `finalText` a number) |

**Typecheck coverage:** `packages/output-filter/tsconfig.json` excludes `test`,
and only `context-gate` runs a separate `tsconfig.test.json`, so three of the
four test files consuming `countTokens` are unchecked today. Either extend
coverage or stop claiming the typecheck step verifies the `number | null`
migration. Note a `Promise<number>` seam **is** assignable to a
`Promise<number | null>` parameter — return types are covariant — so the
declaration never errors; only an `async () => null` *value* does.

## 8. Open questions for architect / critic

1. **§4.3's conservatism.** `MAX_MEASURABLE_CHARS = 32_768` is sized for the
   worst shape, so prose costing ~4 ms is declined above 32 KB. Lowering
   `CHUNK_TARGET` to 128 halves the rate bound and would roughly double the cap
   — at 3.57% drift on TypeScript against 0.26% at 250 (§3.3). Is that trade
   right, and is there a way to raise coverage without a cost predictor, given
   §3.1 says none exists cheaply?
2. **Is `MAX_CHARS_PER_TOKEN = 3.0` robust?** The gap between 2.98 (0.8% drift)
   and 7.81 (2.4%) is wide but sampled from ten shapes. Is there content that
   samples below 3.0 and still distorts badly — for example a run whose first
   250 chars are unrepresentative of the rest?
3. **Is the §3.2 structural bound sound?** It rests on §3.1's linear
   run-length/cost relation, measured on period-16 filler. Does any content
   exceed ≈0.05 µs/char per unit of run length?

## 9. What v1 got wrong

Recorded so the same ground is not re-covered.

- **Fatal:** kept a whole-string routing boolean, so a newline every 1500 chars
  routed pathological input to the unbounded path. `MAX_MEASURABLE_CHARS` was
  derived at 0.14 µs/char from ordinary log text; the real rate on that shape is
  up to 99 µs/char — a ~400× miss on the exact shapes §1 named as exposure.
- Budgeted 100% of the 1500 ms ceiling to one call when two run per event and
  add, overstating headroom by 2×.
- Proved in its own §3.2 that conservative *routing* is free, then reused the
  same proxy to *decline* measurement, refusing every whitespace-free payload
  above 32 KB — including all minified JSON. §3.4 replaces that with a gate
  measured against distortion, which admits JSON, hex, base64 and period-2.
- Claimed "no user-facing output change" while declines silently swap in a
  bytes/4 estimate that is +19.3% wrong on JSON (§5).
- Asserted determinism as an absolute (§4.1) while keeping a time-based load
  race (§4.4). The race stays; the absolute claim does not.
- Its fixture table contained no whitespace-terminated long run, so it could
  not have caught any of the above.

## 10. Definition of Done

Per §9 of the conventions, plus:

- Every measurement table in this spec reproduced on the implementer's machine,
  with any figure differing by more than 2× reported rather than absorbed.
- `saver-run.test.ts` wall clock recorded before and after.
- The §5 decline rate and its effect on the headline savings figure measured on
  a real corpus.
