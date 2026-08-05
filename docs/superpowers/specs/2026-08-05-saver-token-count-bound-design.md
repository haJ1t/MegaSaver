# Design Spec: Bound Token Measurement On The Saver Hot Path

> **Date:** 2026-08-05
> **Packages:** `@megasaver/output-filter`, `@megasaver/context-gate`
> (+ `@megasaver/bench-replay` as a caller)
> **Risk Level:** **HIGH** — the PostToolUse saver runs on every tool call.
> Per risk-modes §12: architect + critic in separate contexts, own worktree.
> **Spec Status:** DRAFT v3. v1 and v2 were both REJECTED at both gates; §9
> records why, so the same ground is not re-covered.
> **Origin:** `wiki/syntheses/verify-fresh-audit-2026-08-01.md` §"The guard
> cannot work".

---

## 1. Problem

`record-output.ts:398` races `countTokens` against a 500 ms timer and omits
the token fields on timeout. The race cannot fire. `countTokens` is `async`
only for the lazy `await loadEncoding()`; after memoization every
`encoding.encode()` is synchronous and holds the event loop, so the timer
callback cannot run until the work has already finished. **The budget bounds
the js-tiktoken load, not the encode.** No value of the constant changes that.

There is no size cap either: `record-output.ts` passes the full `input.raw` to
the counter, and `COMPRESS_FLOOR_BYTES = 2048` is a minimum-to-compress floor.

### 1.1 The live severity is larger than previously recorded

Measured 2026-08-05 on the **currently shipped** code path, 8,000 characters of
ordinary Japanese prose:

| path | time | rate |
|---|---|---|
| whole-string (taken when ASCII whitespace keeps `longestRun` under 2000) | **24,267 ms** | 3,033 µs/char |
| chunked at 1000 (taken otherwise) | 2,997 ms | 375 µs/char |

Extrapolating the whole-string path linearly, a 32 KB CJK tool output stalls
the agent for roughly **97 seconds** today, with the budget unable to
intervene. Non-ASCII output is not an edge case for a tool distributed to
unknown users.

## 2. Why the previous two attempts failed

Both v1 and v2 built a **predicate** that sorted inputs cheaply and then acted
on the answer. Both predicates were defeated by constructed input (§9). The
lesson taken into v3:

> A guard may act on a **computed fact about the input**. It may not act on a
> **prediction about how the tokenizer will behave**, because every cheap
> predictor of tokenizer behaviour has been defeated by a counterexample.

v3 therefore has no predicate, no sampling, and no chunking.

## 3. The cost model

### 3.1 Cost is driven by the regex-matched word, in UTF-8 bytes

js-tiktoken splits input with cl100k's pattern — ` ?\p{L}+`, ` ?\p{N}+`,
` ?[^\s\p{L}\p{N}]+`, `\s+` — and hands each match to `bytePairMerge`, whose
cost is quadratic in the match's **UTF-8 byte length**.

Two consequences that killed the earlier versions:

- **Bytes, not code units.** Above U+07FF one character is three bytes, and
  cost goes as bytes², so a per-character constant measured on ASCII understates
  by up to ~9×.
- **Class transitions, not whitespace.** A word ends at any change of character
  class, not only at a space. Japanese prose punctuated with `。` has no ASCII
  whitespace at all, yet its words are short because `。` is a different class.

Define a **word** as a maximal run of a single non-whitespace class
(letter / number / other), measured in UTF-8 bytes. Measured, 20,000
characters, whole-string encode, `k = (µs per byte) ÷ longestWordBytes`:

| shape | longest word (bytes) | µs/byte | k |
|---|---|---|---|
| ascii prose | 5 | 0.073 | 0.0146 |
| minified JSON | 4 | 0.100 | 0.0250 |
| varied hex | 5 | 0.164 | 0.0329 |
| log lines | 7 | 0.140 | 0.0200 |
| typescript | 8 | 0.194 | 0.0242 |
| base64 wrapped at 76 | 22 | 0.482 | 0.0219 |
| Russian prose | 20 | 0.773 | 0.0386 |
| **Japanese with punctuation** | **36** | 1.776 | **0.0493** |
| `=` rule ×200 + LF | 200 | 7.486 | 0.0374 |
| box-drawing ×64 + LF | 192 | 8.398 | 0.0437 |
| block element ×64 + LF | 192 | 8.553 | 0.0445 |

`k` is stable within 3.4× across ASCII, Cyrillic, CJK, box-drawing and binary
encodings. Worst measured **0.0493**.

### 3.2 The bound is derived, not fitted

Total cost ≈ `k · Σ(wordᵢ²)`. Since `Σ(wordᵢ²) ≤ maxWord · Σwordᵢ = maxWord ·
totalBytes`:

> **cost ≤ k · totalBytes · longestWordBytes**

This is an algebraic upper bound given the quadratic-per-word cost, not an
extrapolation from the table. The table's role is only to bound `k`.

**Both quantities are computed in one O(n) pass over the input.** Nothing is
sampled, predicted, or assumed.

## 4. Design

### 4.1 Algorithm

```
countTokens(text): Promise<number | null>

  1. Single pass over text BY CODE POINT (for…of, never by code unit):
       class(ch) = 0 if /\s/u          (whitespace)
                   1 if /\p{L}/u       (letter)
                   2 if /\p{N}/u       (number)
                   3 otherwise
       A word is a maximal run of one class among {1,2,3}.
       totalBytes        = Σ utf8ByteLength(ch)
       longestWordBytes  = max over words of Σ utf8ByteLength(ch), else 0

  2. if totalBytes * longestWordBytes > MAX_WORK_UNITS  ->  null

  3. return (await loadEncoding()).encode(text).length
```

Step 3 encodes the **whole string**. There is no chunking, so no BPE merge is
ever broken and **every stored count is the tokenizer's own output, exact**.
This is what makes the field's existing contract — "a value in a field named
`rawTokens` is measured or absent" — literally true rather than aspirational.

The algorithm determines its own output. There is no split point to choose, no
tie to break (a maximum needs none), and no whitespace-boundary convention:
iterating by code point makes surrogate pairs unrepresentable as a split, and
the whitespace class is pinned to Unicode `\s` rather than an ASCII subset.

`longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE` are **deleted**.

### 4.2 The constant

| constant | value | derivation |
|---|---|---|
| `MAX_WORK_UNITS` | 5_000_000 | 750 ms ÷ 0.05 µs = 15,000,000, ÷ 3 for machine headroom |

The 750 ms is half the operator's 1500 ms per-tool-call ceiling, because
`record-output.ts:399` runs two counters over `raw` and `finalText`; both are
synchronous, so `Promise.all` buys no concurrency and **they add**.

Verified end to end — each shape generated at exactly the size the bound
admits, then encoded whole:

| shape | longest word | bytes admitted | measured | vs 750 ms |
|---|---|---|---|---|
| ascii prose | 5 | 1,000,000 | 57 ms | 13.2× |
| minified JSON | 4 | 1,250,000 | 122 ms | 6.1× |
| Japanese with punctuation | 36 | 138,888 | 229 ms | 3.3× |
| `=` rule ×200 | 200 | 25,000 | 196 ms | 3.8× |
| box-drawing ×64 | 192 | 26,036 | 213 ms | 3.5× |

A single work budget gives coverage proportional to cheapness: a megabyte of
prose or JSON is measured, while a rule-heavy log is admitted to 25 KB. Neither
v1's nor v2's flat size cap could do this.

### 4.3 `@megasaver/context-gate` — `record-output.ts`

- **Keep** the `Promise.race`, renamed `ENCODING_LOAD_BUDGET_MS`, comment
  corrected. It genuinely bounds the async `loadEncoding()`; it only ever
  falsely claimed to bound the encode. 500 ms stays — sized above a measured
  cold start of 101–132 ms.
- `null` from **either** counter omits all three token fields. The production
  case is asymmetric: the large `raw` is declined while the small `finalText`
  measures fine.
- A thrown error stays a separate path from a decline.

**A leaked `null` is worse than a lost row.** `packages/stats/src/store.ts:443`
*throws* `StatsError("schema_invalid")` (the schema at `event.ts:21` accepts
`undefined` and rejects `null`); `record-output.ts:419` calls
`appendOverlayEvent` outside the surrounding try; and
`apps/cli/src/hooks/saver-run.ts:153` documents "on any failure emits nothing →
the model keeps the original tool output". So a leaked `null` means the tool
output is **not compressed at all**, on exactly the large outputs the saver
exists for. The test for this must assert the uncompressed-passthrough
outcome, not a missing row.

**Pre-existing contract violation to fix in the same change:**
`packages/context-gate/src/run.ts:51-52` hardcodes `rawTokens: 0,
returnedTokens: 0` in `unchangedResult`. It does not currently reach the
overlay event, but it is exactly the zero-fill the contract forbids.

### 4.4 `@megasaver/bench-replay` — `token-divergence.ts`

`TokenCounters.count` widens to `Promise<number | null>`.
`TokenDivergenceReport` gains `excludedCorpora: string[]`; a declined corpus is
named and contributes to neither `samples` nor `overallRealOverEstimate`.

### 4.5 Determinism — stated exactly

Steps 1 and 2 are pure functions of the input bytes, so the decline decision is
identical on every machine and every call.

The `ENCODING_LOAD_BUDGET_MS` race in §4.3 is **not** deterministic, and this
spec does not claim otherwise. `loadEncoding()` memoizes, so only the first
call in a process can lose that race; byte-identical input can therefore
decline on call 1 and succeed on call 2 within a single process. That is a
pre-existing property of the load path, it is narrow, and bounding a genuinely
async load is worth it. v2 asserted absolute determinism while keeping this
race; the assertion is withdrawn, not the race.

## 5. Effect on reported numbers

Declines are visible: `measuredTokenCoverage` and the
`token source: N% measured` line already exist. But
`honest-metrics.ts:130-137` substitutes `tokensFromBytes(e.rawBytes)` for an
absent pair, and that estimator is recorded at `tokens.ts:61-62` as +19.3%
wrong on JSON — and measured at **−31.7%** on log text containing a rule. So a
decline swaps a measured count for a known-biased estimate whose sign is not
even consistent.

v3 reduces how often this fires: JSON, hex, base64 and CJK prose are now
**accepted** (§3.1), where v1 and v2 declined them. Implementation must report
the observed decline rate and its effect on the headline savings figure on a
real corpus. This is a Definition-of-Done item.

## 6. Rejected alternatives

| alternative | why rejected |
|---|---|
| Whole-string routing boolean (`longestRun > MAX_SAFE_RUN`) | v1: a newline every 1500 chars routes pathological input to the unbounded path |
| Chunking, with any accuracy gate | v2: defeated three ways — multi-byte content samples *low* and passes; a single rule in 32 KB of logs is declined though its true drift is 0.059%; and `hex(250) + "="×10000` is one run whose prefix samples 1.72 and whose body drifts +14.7% |
| Chunking without a gate | Stores an approximation in a field whose contract is "measured or absent"; drift reaches +31% upward and feeds `estimated-value.ts:45` straight into USD |
| Same-character-run detector | Misses periods 2–16, seconds-slow at 10 KB |
| `worker_threads` offload | Multi-MB ranks load per worker on a per-tool-call hook, which `tokens.ts:26` forbids |
| Σ(run²) budget on whitespace runs | Over-predicts on varied content: 400 KB minified JSON scores ~8,000 s and encodes in 39 ms |
| Raise `TOKEN_COUNT_BUDGET_MS` | Structurally dead; no value fixes it |
| Fall back to `estimateTokens` above the cap | Puts an estimate in a field whose contract is "measured or absent" |

## 7. Testing

**No duration assertion may use a framework timeout.** A Vitest per-test
timeout is a `setTimeout` and cannot bound synchronous work — demonstrated at
70,621 ms reported green under a 5,000 ms timeout. Measure with `Date.now()`
around the call.

**Fixtures are named by recipe and size**, so DoD §10's reproduction
requirement is satisfiable. `repeat(unit, n)` means the unit repeated and
sliced to exactly `n` characters:

| id | recipe | n |
|---|---|---|
| `PROSE` | `"The quick brown fox jumps over the lazy dog. "` | 20,000 |
| `TS` | `"export function foo(bar: string): number { return bar.length; }\n"` | 20,000 |
| `LOGS` | `"2026-08-05 INFO handled request id=abc123 in 42ms\n"` | 20,000 |
| `JSON_MIN` | `'{"a":1,"bb":22,"ccc":333,"dddd":4444},'` | 20,000 |
| `HEX` | `"9f3a7c2e1b8d40567aef"` | 20,000 |
| `B64` | `"aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Rf"×2` sliced to 76 + `"\n"` | 20,000 |
| `JA` | `"日本語のテキストです。処理速度を測定しています。"` | 20,000 |
| `JA_NOPUNCT` | `"日本語のテキストです処理速度を測定しています"` | 20,000 |
| `RU` | `"Быстрая коричневая лиса прыгает через ленивую собаку. "` | 20,000 |
| `RULE_64` | `"="×64 + "\n"` | 20,000 |
| `RULE_200` | `"="×200 + "\n"` | 20,000 |
| `BOX_64` | `"═"×64 + "\n"` | 20,000 |
| `SURROGATE` | `"😀😀 "` | 20,000 |

**Exactness is the headline property and must be asserted directly:** for every
fixture that is not declined, `countTokens(f)` equals
`encoding.encode(f).length`. Not "within X%" — equal. v3 has no approximation,
so any drift is a bug.

Mutations that must fail, each with the threshold that kills it:

| # | mutation | must break |
|---|---|---|
| 1 | `MAX_WORK_UNITS` × 100 | duration ≤ 750 ms on `RULE_200` sized at the admitted maximum (mutant ≈ 20 s) |
| 2 | measure word length in code units, not UTF-8 bytes | duration ≤ 750 ms on `BOX_64` at its admitted maximum (mutant admits 3× the bytes) |
| 3 | word = whitespace-delimited run (ignore class transitions) | `JA` must be **accepted**; the mutant sees a 60,000-byte word and declines it |
| 4 | `>` → `>=` in step 2 | boundary case at exactly `MAX_WORK_UNITS` must be accepted |
| 5 | `return null` → `return 0` | `measuredTokenCoverage` assertion on `JA_NOPUNCT` |
| 6 | both-null check → single-sided in `record-output` | asymmetric case: `raw` declines, `finalText` returns a number; assert uncompressed passthrough does **not** occur and fields are omitted |
| 7 | iterate by code unit instead of code point | `SURROGATE` word-byte count |
| 8 | whitespace class → ASCII-only subset | `JA` acceptance (`。` is not ASCII whitespace) |

Mutation 3 is the one that guards §3.1's central correction; without it a
future change reverts to whitespace runs and silently declines all CJK.

**Typecheck coverage:** `packages/output-filter/tsconfig.json` excludes `test`,
and only `context-gate` runs a separate `tsconfig.test.json`, so three of the
four test files consuming `countTokens` are unchecked today. Either extend
coverage or drop the claim that typecheck verifies this migration. Note a
`Promise<number>` seam **is** assignable to a `Promise<number | null>`
parameter — return types are covariant — so only an `async () => null` *value*
errors.

### 7.1 Change surface the implementer must handle

- `packages/output-filter/test/tokens.test.ts` imports `MAX_SAFE_RUN`
  (deleted — the file will not compile) and asserts exactness on a
  **56,000-character** fixture; under v3 that fixture's admitted size must be
  rechecked against `MAX_WORK_UNITS`.
- `packages/bench-replay/src/token-divergence.ts:22,24,41,46` — signature and
  the two aggregate reductions.
- `packages/context-gate/src/record-output.ts:99` — the `countTokensImpl` seam
  type, and the same declaration in the test file's local `runFixture` helper.
- `packages/context-gate/src/run.ts:51-52` — the hardcoded zero-fill (§4.3).

## 8. Open questions for architect / critic

1. **Is `k ≤ 0.05` safe?** It is bounded by eleven shapes spanning ASCII,
   Cyrillic, CJK, box-drawing, JSON and base64, worst 0.0493. Is there content
   whose cost per (byte × word-byte) exceeds it — particularly scripts not
   sampled here (Arabic, Devanagari, Hangul, emoji sequences, combining marks)?
2. **Is `Σ(wordᵢ²) ≤ maxWord · totalBytes` the right slack to accept?** It is
   exact algebra, but loose when one long word sits in a large benign text: a
   1 MB log with a single 200-byte token is charged as if every byte were in a
   200-byte word, and declined. Is a true `Σ(wordᵢ²)` accumulator — the same
   O(n) pass, one more variable — better than the `maxWord` bound?
3. **Is the class partition right?** `\p{L}` / `\p{N}` / other mirrors cl100k's
   pattern but ignores its leading-space alternation and its `'s`/`'ll`
   contractions. Does any input make the real regex produce a match longer than
   this model's word?

## 9. What v1 and v2 got wrong

**v1** — routed on `longestRun > MAX_SAFE_RUN`. A newline every 1500 chars kept
pathological input under the threshold and sent it to the unbounded
whole-string path: measured 116 s where the spec predicted 294 ms, a ~400×
miss, on the exact shapes v1's own §1 named as production exposure. Also
budgeted 100% of the ceiling to one of two additive calls; used a
routing proxy it had itself proved was free for *routing* as a *declining*
proxy, refusing all minified JSON; claimed "no user-facing output change" while
declines swap in a biased estimator; and its fixture table contained no
whitespace-terminated long run, so it could not have caught any of it.

**v2** — replaced the routing boolean with universal chunking plus a
sample-based accuracy gate. Both halves failed. The cost bound was stated per
**character** while the cost is per **UTF-8 byte**, so multi-byte content
exceeded it by up to 8.7× — and because multi-byte characters are ≥1 token
each, they sample *low* and the gate waved through exactly what broke the
bound. The gate was independently defeated by a single run whose prefix
misrepresents its body. And v2 asserted absolute determinism in §4.1 while
keeping a timer race in §4.4, contradicting its own §9.

Both failures share one shape: **a constant measured on one class of input,
asserted as universal.** v3's `k` is bounded across eleven shapes in four
scripts and two binary encodings, and §8 Q1 asks explicitly whether that is
still not enough.

## 10. Definition of Done

Per §9 of the conventions, plus:

- Every measurement table reproduced on the implementer's machine from the §7
  fixture recipes; any figure differing by more than 2× reported, not absorbed.
- The exactness property asserted for every non-declined fixture.
- `saver-run.test.ts` wall clock recorded before and after.
- The §5 decline rate and its effect on the headline savings figure measured on
  a real corpus.
- The §1.1 CJK regression re-measured post-change.
