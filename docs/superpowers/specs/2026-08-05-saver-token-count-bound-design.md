# Design Spec: Bound Token Measurement On The Saver Hot Path

> **Date:** 2026-08-05
> **Packages:** `@megasaver/output-filter`, `@megasaver/context-gate`
> (+ `@megasaver/bench-replay` as a caller)
> **Risk Level:** **HIGH** — the PostToolUse saver runs on every tool call.
> **Spec Status:** DRAFT v5 — v4's estimator was rejected at code review.
> §7 records why. Every rejection had one cause: a model of the tokenizer that
> some input class fell outside. v4 does not model the tokenizer — it uses the
> tokenizer's own partition, sourced from the tokenizer at runtime.

---

## 1. Problem

`record-output.ts:398` races `countTokens` against a 500 ms timer. The race
cannot fire: `countTokens` is `async` only for `await loadEncoding()`, and after
memoization every `encoding.encode()` is synchronous and holds the event loop,
so the timer callback cannot run until the work has finished. **The budget
bounds the js-tiktoken load, not the encode.** There is no size cap either.

Measured on the **currently shipped** code, all with the budget silent:

| input | time |
|---|---|
| 8,000 chars Japanese prose (whole-string path) | 24,267 ms |
| 32,768 chars of newlines | 46,218 ms |
| `"a"` + 50,000 spaces | 114,331 ms |
| 400 KB repeated `"X"` | 14,388 ms |

A 32 KB blank-line block — `cat` of a padded file, a cleared progress area, a
test runner's separator — hangs the agent for ~46 s per counter, twice per
event, after which `saver-run.ts:153` emits nothing and the output is passed
through uncompressed.

## 2. Why the three previous attempts failed

Each built a cheap **model** of what the tokenizer would do, then acted on it.
Each model was defeated by a constructed input:

- **v1** routed on the longest whitespace-delimited run. A newline every 1500
  chars kept pathological input under the threshold and onto the unbounded
  path — 116 s where the spec predicted 294 ms.
- **v2** chunked everything and gated accuracy on a sampled prefix. The bound
  was stated per character while cost is per UTF-8 byte (8.7× miss on
  multi-byte), and multi-byte content samples *low* so the gate waved through
  exactly what broke the bound.
- **v3** modelled the tokenizer's word partition by character class. Whitespace
  runs are **single BPE matches** but scored zero work, so `"\n"×32768` was
  admitted at a product of literally zero and measured 46 s. The spec also
  quoted a `pat_str` that was GPT-2's, not cl100k's.

The rule taken from this: **do not model the tokenizer's partition. Ask it.**

`js-tiktoken`'s encoder exposes its own pattern as a public own property,
`enc.patStr`. The same string that drives `encode` drives the guard, so the two
cannot diverge.

## 3. Cost model

### 3.1 Cost is driven by the regex-matched word, in UTF-8 bytes

js-tiktoken splits input with cl100k's own pattern and hands each match to
`bytePairMerge`, whose cost is quadratic in the match's **UTF-8 byte length**.

Two consequences that killed earlier versions:

- **Bytes, not code units.** Above U+07FF one character is three bytes and cost
  goes as bytes², so a per-character constant measured on ASCII understates by
  up to ~9x.
- **Class transitions, not whitespace.** A match ends at any change of character
  class, and a *whitespace run is itself one match*. v3 scored whitespace at
  zero and admitted 32 KB of newlines that took 46 s.

Cost per byte rises linearly with the size of the match a byte sits in, with a
per-match overhead dominating below ~16 bytes. Swept over eight content classes
and eleven match sizes, worst us/byte by maximum match size:

| max match (B) | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 |
|---|---|---|---|---|---|---|---|---|---|---|
| worst us/byte | 0.292 | 0.369 | 0.595 | 1.610 | 2.287 | 4.382 | 8.705 | 17.489 | 34.736 | 69.815 |

Linear above ~16 bytes (17.489/128 = 0.137, 34.736/256 = 0.136, 69.815/512 =
0.136) with a floor below it — hence the `C0` term in §3.2.

Two corrections from the review record are load-bearing. **Whitespace runs are
a class**, per above. **NFD accented Latin is benign** — its combining marks are
not `\p{L}`, so runs break every two characters; its apparently extreme cost in
an earlier review was an artifact of normalising by v3's wrong word model.

### 3.2 The bound sums per match; it does not take a global maximum

> **v4 used `(C₀ + maxMatchBytes) · totalBytes` and that was wrong.** A global
> maximum times a global total is tight only when every match is the same size,
> so one outlier contaminates every unrelated byte. Measured: 50 KB of clean
> log containing a **single** 800-byte base64 line scored **22.7× the budget**
> and was declined, though it encodes in 31.8 ms. Every v4 fixture was
> `repeat(unit, n)` — homogeneous by construction — so the suite could not fail
> on the estimator's only failure mode.

The shipped form charges each match for itself:

> **cost ≤ k · Σ over matches of (C₀ + bytesᵢ) · bytesᵢ**, with **k = 0.0462 µs**
> and **C₀ = 4 bytes**.

Same single pass, same cost, and it still bounds a per-match quadratic merge.
Measured `k` over fifteen shapes spanning four scripts, two binary encodings,
whitespace runs, high-match-count input and **mixed content**: minified JSON
0.0140, log lines 0.0153, prose 0.0186, wrapped base64 0.0247, clean log + one
800-byte line 0.0284, clean log + one 2000-byte line 0.0331, TypeScript 0.0397,
`=` rule ×200 0.0406, `x\n` 0.0409, newline run 0.0419, `a1` 0.0422, Arabic
0.0427, whitespace run 0.0428, box-drawing 0.0449, **punctuated Japanese
0.0462**. Spread 3.3×.

The quantity to bound is a maximum over a **finite sweep**, not over all
possible content — that is the structural difference from v1–v3, each of which
needed a constant that held over an unbounded domain and was eventually broken
by a new shape.

## 4. Design

### 4.1 Algorithm

```
countTokens(text): Promise<number | null>

  1. encoding = await loadEncoding()
     pattern  = new RegExp(encoding.patStr, "gu")    // the tokenizer's own

     one pass over text.matchAll(pattern):
       work = Σ over matches of (MATCH_OVERHEAD_BYTES + bytes) * bytes

  2. if work > MAX_WORK_UNITS  ->  null

  3. return encoding.encode(text).length
```

Step 3 encodes the whole string. Nothing is chunked, so **every stored count is
the tokenizer's own output, exact** — which makes the field's existing contract
("a value in a field named `rawTokens` is measured or absent") literally true.

`longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE` are deleted.

Steps 1–2 are exported as `tokenWorkUnits(text): Promise<number | null>` so the
decline decision can be asserted directly rather than inferred from a
stopwatch. Two mutations survived a timing-only suite — measuring match length
in code units, and `>` becoming `>=` — because both change the decision without
pushing any fixture past the budget. `patStr` is an own property at runtime but
absent from js-tiktoken's published types, so it is read defensively: without
it the cost cannot be bounded and `countTokens` declines rather than encoding
unbounded.

An early `text.length > MAX_WORK_UNITS / (MATCH_OVERHEAD_BYTES + 1)` check
refuses oversized input before the ranks load, since UTF-8 byte length is never
below UTF-16 code-unit length.

| constant | value | derivation |
|---|---|---|
| `MATCH_OVERHEAD_BYTES` | 4 | §3.1 floor term |
| `MAX_WORK_UNITS` | 5_000_000 | 750,000 µs ÷ 0.0462 = 16,227,553, ÷3 for machine headroom |

The 750 ms is half the operator's 1500 ms per-tool-call ceiling, because
`record-output.ts:399` runs two counters and both are synchronous, so
`Promise.all` buys no concurrency and they add.

### 4.2 Verification at the admitted maximum

Each shape generated at exactly the size the bound admits, then encoded whole:

| shape | bytes admitted | measured | margin vs 750 ms |
|---|---|---|---|
| minified JSON | 773,810 | 98 ms | 7.6x |
| log lines | 586,856 | 67 ms | 11.3x |
| ascii prose | 558,312 | 37 ms | 20.1x |
| typescript | 503,143 | 32 ms | 23.4x |
| base64 wrapped at 76 | 263,547 | 128 ms | 5.8x |
| Japanese with punctuation | 124,227 | 215 ms | 3.5x |
| `=`x1500 rule | 3,694 | 201 ms | 3.7x |
| **clean log + one 800-byte line** | **50,801** | **29 ms** | **26.0x** |

The last row is the case v4 got wrong: it scored 22.7x the budget and was
declined. Coverage is roughly triple v4's throughout — prose 180 KB -> 558 KB,
JSON 225 KB -> 774 KB, Japanese 42 KB -> 124 KB — because charging each match
for itself stops one long line from condemning the document around it.

### 4.3 `@megasaver/context-gate` — `record-output.ts`

- **Keep** the `Promise.race`, renamed `ENCODING_LOAD_BUDGET_MS`, comment
  corrected: it bounds the async `loadEncoding()`, which is real, and never
  bounded the encode. 500 ms stays, sized above a measured 101–132 ms cold
  start.
- `null` from **either** counter omits all three token fields. Production is
  asymmetric: the large `raw` declines while the small `finalText` measures.
- A thrown error stays a separate path from a decline.

**A leaked `null` is worse than a lost row.** `stats/src/store.ts:443` *throws*
(`event.ts:22` accepts `undefined`, rejects `null`), `record-output.ts:419`
calls `appendOverlayEvent` outside the surrounding try, and
`saver-run.ts:153` documents "on any failure emits nothing" — so the tool
output is **not compressed at all**. The test asserts that outcome, not a
missing row.

`estimated-value.ts:37` branches on `=== undefined`, so a `null` there would
increment `measuredRows` and add zero — inflating coverage while contributing
nothing. Omission must be by absent key, never `deltaTokens: null`.

### 4.4 `@megasaver/bench-replay`

`TokenCounters.count` widens to `Promise<number | null>`;
`TokenDivergenceReport` gains `excludedCorpora: string[]`. A declined corpus is
named and contributes to neither `samples` nor `overallRealOverEstimate`.

### 4.5 Determinism, stated exactly

Steps 1 and 2 are pure functions of the input bytes and of `encoding.patStr`,
so the decline decision is identical on every machine and every call.

The `ENCODING_LOAD_BUDGET_MS` race is **not** deterministic and this spec does
not claim otherwise: `loadEncoding()` memoizes, so only the first call in a
process can lose it, and byte-identical input can therefore decline on call 1
and succeed on call 2 within one process. That is pre-existing, narrow, and
worth keeping to bound a genuinely async load. v2 asserted absolute determinism
while keeping this race; the assertion is withdrawn, not the race.

## 5. Effect on reported numbers

`measuredTokenCoverage` and the `token source: N% measured` line already report
declines. But `honest-metrics.ts:130-137` substitutes
`tokensFromBytes(e.rawBytes)`, recorded at `tokens.ts:61-62` as +19.3% wrong on
JSON and measured at −31.7% on log text with a rule — so the substitute is
biased and its sign is not even consistent.

**Cross-version discontinuity.** Rows written by today's code with
`longestRun > 2000` were chunked and inflated upward (0.05% on base64, 0.20% on
space-free JSON). After this change the same shapes are exact-or-absent, so any
aggregation window straddling the deploy mixes two measurement regimes.
`honest-metrics.ts:126-137` has no schema-version discriminator. This is
recorded, not fixed here.

## 6. Rejected alternatives

| alternative | why rejected |
|---|---|
| Route on whitespace-delimited run length | v1: a newline every 1500 chars defeats it |
| Chunk + accuracy gate on a sampled prefix | v2: defeated three ways; multi-byte samples low and passes |
| Chunk without a gate | Stores an approximation in a field contracted as "measured or absent"; drift reaches +31% upward into `estimated-value.ts:45` |
| Model the partition by character class | v3: whitespace runs are single matches and score zero; `"\n"×32768` admitted at work 0, measured 46 s |
| `k · totalBytes · maxWord` with no floor term | v3: `"x\n"` has max word 1 under any word model, admitted at 5 MB, measured 996 ms |
| Same-character-run detector | Misses periods 2–16, seconds-slow at 10 KB |
| `worker_threads` offload | Multi-MB ranks load per worker on a per-tool-call hook |
| Σ(run²) on whitespace runs | Over-predicts varied content: 400 KB minified JSON scores ~8,000 s, encodes in 39 ms |
| Raise `TOKEN_COUNT_BUDGET_MS` | Structurally dead; no value fixes it |
| Fall back to `estimateTokens` above the cap | Puts an estimate in a "measured or absent" field |

## 7. What v1, v2 and v3 got wrong

Kept so the ground is not re-covered. All three shared one failure: **a
constant or partition measured on one class of input, asserted as universal.**

- **v1** — whitespace-run routing; newline hole; budgeted 100% of the ceiling
  to one of two additive calls; used a routing proxy it had itself proved free
  for routing as a *declining* proxy, refusing all minified JSON.
- **v2** — per-character bound against per-byte cost; the accuracy gate was
  anti-correlated with the cost bound it was meant to backstop, and was
  independently defeated by a prefix that misrepresents its run body.
- **v3** — quoted GPT-2's `pat_str` instead of cl100k's, missing four
  alternatives; whitespace scored zero work; no per-match term, so
  high-match-count input was admitted at 5 MB; and `k` was set equal to the
  worst shape measured, with zero margin.

v4's constants bound a **maximum over a finite sweep**, not a fit over sampled
content, and the partition is read from the tokenizer rather than restated.

## 8. Testing

**No duration assertion may use a framework timeout** — a Vitest per-test
timeout is a `setTimeout` and cannot bound synchronous work; a 70,621 ms call
was demonstrated reporting green under a 5,000 ms timeout. Measure with
`Date.now()` around the call.

**Fixtures by recipe and size**, so DoD reproduction is satisfiable.
`repeat(unit, n)` means the unit repeated and sliced to exactly `n` characters:

| id | unit | n |
|---|---|---|
| `PROSE` | `"The quick brown fox jumps over the lazy dog. "` | 20,000 |
| `TS` | `"export function foo(bar: string): number { return bar.length; }\n"` | 20,000 |
| `JSON_MIN` | `'{"a":1,"bb":22,"ccc":333},'` | 20,000 |
| `JA` | `"日本語のテキストです。処理速度を測定しています。"` | 20,000 |
| `NFD` | `"éééé "` | 20,000 |
| `RULE_1500` | `"="×1500 + "\n"` | 20,000 |
| `BOX_64` | `"═"×64 + "\n"` | 20,000 |
| `SPACES` | `" "` | 32,768 |
| `NEWLINES` | `"\n"` | 32,768 |
| `XLF` | `"x\n"` | 400,000 |
| `A1` | `"a1"` | 400,000 |

**Exactness is the headline property:** for every fixture that is not declined,
`countTokens(f)` **equals** `encoding.encode(f).length`. Not a tolerance —
v4 has no approximation, so any difference is a bug.

**Bounded-cost property:** for every fixture, `countTokens` either returns
`null` or completes within the per-call budget, asserted on a measured
duration.

Mutations that must fail. All eight verified 2026-08-06:

| # | mutation | must break |
|---|---|---|
| 1 | `MAX_WORK_UNITS` x100 | 7 tests, incl. per-call budget on `RULE_1500` |
| 2 | `MATCH_OVERHEAD_BYTES` -> 0 | 3 tests, incl. "charges per-match overhead" |
| 3 | match length in code units | 2 tests, incl. `BOX_64` decline |
| 4 | skip whitespace matches | 5 tests, incl. `SPACES`/`NEWLINES` decline |
| 5 | per-match sum -> global maximum | 7 tests, incl. both `HETERO_*` fixtures |
| 6 | `>` -> `>=` | the exact-boundary test |
| 7 | `return null` -> `return 0` | 6 tests |
| 8 | delete the length pre-check | the pre-check timing test (375 ms vs 50 ms) |

Mutations 4 and 5 guard the corrections that rejected v3 and v4. Mutation 8
needed its fixture resized: at the original size the work budget declined the
input anyway, so the pre-check was unguarded and the mutant survived.

**Typecheck coverage:** `packages/output-filter/tsconfig.test.json` and
`packages/bench-replay/tsconfig.test.json` already exist; what is missing is
the second clause in each `package.json`, which currently reads
`"typecheck": "tsc -b --noEmit"` where `context-gate` reads
`"tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit"`. One clause per
package.

### 8.1 Change surface

- `packages/output-filter/test/tokens.test.ts` — imports the deleted
  `MAX_SAFE_RUN`; will not compile until updated.
- `packages/output-filter/test/tokens-real.test.ts:8,19,24-26` — assertions
  against the widened return.
- `packages/bench-replay/src/token-divergence.ts:22,24,41,46`.
- `packages/context-gate/src/record-output.ts:99` and the same seam declaration
  in the test file's local `runFixture` helper.

**Explicitly not in scope:** `packages/context-gate/src/run.ts:51-52`. An
earlier draft called its `rawTokens: 0` a contract violation. It is not — that
is `FilterOutputResult.rawTokens` (`output-filter/src/types.ts:105`), a
non-optional field fed by `estimateTokens`, a different field from the overlay
event's. Changing it would break a persisted zod schema
(`replay-trace.ts:95`), a public MCP tool response type
(`mcp-bridge/src/tools/search-code.ts:74,301`) and three other consumers.

### 8.2 Implementation result (2026-08-05)

All four §1 figures now decline in ≤1 ms. Ordinary content is unaffected:
100 KB of log text measures in 19 ms.

Largest input still measured, by shape:

| shape | measured up to | encode time at that size |
|---|---|---|
| minified JSON | 225,000 B | 27 ms |
| ascii prose | 180,000 B | 12 ms |
| log lines | 150,000 B | 18 ms |
| typescript | 138,461 B | 9 ms |
| base64 wrapped at 76 | 69,230 B | 33 ms |
| Japanese with punctuation | 41,859 B | 72 ms |
| unpunctuated Japanese | 1,338 B | 83 ms |
| `=`×1500 rule | 1,339 B | 72 ms |

Every mutation in §8 turns its named test red; mutation 8 fails with
`schema_invalid`, which is the throw §4.3 predicted.

One CLI fixture had to change: `apps/cli/test/audit/honest-overlay.test.ts`
used 2,000 lines each containing a 40-character unbroken run. That is 92 KB
with a 41-byte largest match, which the bound declines — and the decline is
justified on the real number, since the fixture measures **225 ms** per
counter, 450 ms per event. It was retargeted to ordinary log lines. The work
model over-predicts that shape by 3×, which is the cost of `Σ(matchᵢ²) ≤
maxMatch · totalBytes`; a true `Σ(matchᵢ²)` accumulator would predict 516 ms
instead of 567 ms and still decline it, so it was not adopted.

## 9. Definition of Done

Per §9 of the conventions, plus:

- §3.1's sweep and §4.2's table reproduced on the implementer's machine from
  the §8 recipes; any figure differing by more than 2× reported, not absorbed.
- Exactness asserted for every non-declined fixture.
- `saver-run.test.ts` wall clock recorded before and after.
- The §1 shipped-code figures re-measured post-change.
