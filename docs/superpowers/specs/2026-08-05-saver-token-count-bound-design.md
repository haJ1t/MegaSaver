# Design Spec: Bound Token Measurement On The Saver Hot Path

> **Date:** 2026-08-05
> **Packages:** `@megasaver/output-filter`, `@megasaver/context-gate`
> (+ `@megasaver/bench-replay` as a caller)
> **Risk Level:** **HIGH** — the PostToolUse saver runs on every tool call. The
> defect blocks the agent's event loop for seconds to minutes on input the
> operator cannot predict, and the guard written to prevent it cannot fire.
> Per risk-modes §12: architect + critic in separate contexts, own worktree.
> **Spec Status:** DRAFT — awaiting user approval, then architect + critic.
> **Origin:** Escalated from `wiki/syntheses/verify-fresh-audit-2026-08-01.md`
> §"The guard cannot work", confirmed live by measurement on 2026-08-05.

---

## 1. Problem

`record-output.ts:398` races `countTokens` against
`setTimeout(TOKEN_COUNT_BUDGET_MS)` (500 ms) and omits the token fields on
timeout. The race cannot work.

`countTokens` is `async` only for the lazy `await loadEncoding()`. After the
encoding is memoized, every `encoding.encode()` call is synchronous and the
chunk loop never yields. Synchronous work holds the event loop, so the timer
callback cannot run until the tokenizer has already returned. **The budget
bounds the js-tiktoken load, not the encode.** No value of the constant changes
this; the guard is structurally dead.

Measured 2026-08-05 on this machine, after the chunk guard (`32846bfd`) landed,
400 KB input, budget set to 500 ms:

| input shape | time | budget fired |
|---|---|---|
| ordinary log text | 41 ms | no |
| zero-padded base64 | 2,702 ms | **no** |
| repeated character `"X"` | 14,388 ms | **no** |
| separator spam `"="` | 15,271 ms | **no** |

There is no size cap either: `record-output.ts` passes the full `input.raw` to
the counter, and `COMPRESS_FLOOR_BYTES = 2048` is a minimum-to-compress floor,
not a ceiling.

**Production exposure.** Any tool output containing a single unbroken
non-whitespace run over `MAX_SAFE_RUN` (2000 chars) takes the chunked path,
whose cost is linear in input size with no ceiling. Hex dumps of zeroed
regions, progress-bar spam, long horizontal rules, and padded base64 all
qualify.

## 2. What the chunk guard did and did not fix

`32846bfd` changed the shape from quadratic to linear. It did not add a bound.

| chunk size | 100 KB worst shape | 400 KB repeated `"X"` |
|---|---|---|
| 1000 (today) | 5,277 ms | 15,011 ms |
| 250 | 1,316 ms | 3,785 ms |
| 125 | 666 ms | 1,924 ms |

Cost is linear in chunk size, so per-chunk cost is quadratic in it. Chunk size
buys a constant factor. It is not a ceiling and must not be sold as one.

## 3. Two measurement results that constrain the design

### 3.1 The existing detector is conservative, and that is load-bearing

`longestRun` measures the longest **whitespace-delimited** run. The pathology is
character **repetition**. The code comment already admits the mismatch and calls
itself "a deliberately CONSERVATIVE proxy."

A same-character-run detector was proposed to close the gap and **was measured
and refuted**. At 10 KB, whole-string encode:

| shape | same-char run | encode |
|---|---|---|
| period 1 `"X"` | 10,000 | 3,913 ms |
| period 2 `"ab"` | **0** | **2,822 ms** |
| period 3 `"abc"` | **0** | **4,112 ms** |
| period 8 | **0** | **4,684 ms** |
| period 16 | **0** | **5,072 ms** |
| period 20 hex | 0 | 2 ms |
| random | 3 | 5 ms |

Periods 2 through 16 are slow and carry a same-character run of zero. A
same-character detector would route every one of them to the whole-string path,
which is **worse than today**. `longestRun` catches them all precisely because
it flags anything whitespace-free.

**Do not replace `longestRun`.** Distinguishing "slow repetitive" from "fast
varied" requires knowing BPE merge behaviour, which is the expensive thing being
guarded against.

### 3.2 Over-chunking safe input is free

The conservative proxy also chunks fast whitespace-free shapes. Measured at
400 KB, chunked against whole-string:

| shape | whole | chunked | penalty | token drift |
|---|---|---|---|---|
| varied hex | 87 ms | 72 ms | 0.8× | +0.00% |
| minified JSON | 39 ms | 40 ms | 1.0× | +0.07% |

The conservatism costs nothing measurable. This removes the only argument for
touching the detector.

## 4. Design

### 4.1 A size cap, not a working timer

The replacement for the dead race is a **deterministic size cap**, not a
repaired timer.

A time-based cutoff would violate the determinism contract (I11): the same
event would be measured on a fast machine and omitted on a slow one, so two
runs over byte-identical input would produce different stored events. A size
cap is a pure function of the input.

This is also the decisive argument against moving tokenization to a worker
thread. Making the timer real would make measurement machine-dependent, and
would additionally pay a multi-MB ranks load per worker on a hook that fires on
every tool call — which `tokens.ts:26` explicitly forbids on the hot path.

### 4.2 `@megasaver/output-filter` — `tokens.ts`

- `CHUNK_SIZE` 1000 → **250**. Worst-case chunked cost falls from 5,277 to
  1,316 ms per 100 KB; varied input's token count is byte-identical at both
  sizes (320,000 tokens on the 400 KB hex fixture).
- Two caps, each derived from the operator-set **1500 ms** stall ceiling
  (matching `saver-run.ts:102` `DAEMON_TIMEOUT_MS`, "a hung socket must not
  stall the hook") and a measured worst-case rate:

  | constant | value | path | worst observed rate | predicted worst case |
  |---|---|---|---|---|
  | `MAX_REPETITIVE_CHARS` | 32,768 | chunked | 13.16 µs/char (period 16) | 431 ms |
  | `MAX_MEASURABLE_CHARS` | 2,097,152 | whole-string | 0.14 µs/char (ordinary log text) | 294 ms |

  Headroom against the ceiling is 3.5× and 5.1× respectively, so a machine up
  to 3× slower than this one still honours it. A 2 MiB single tool output is
  already far outside observed sizes; the cap exists so the whole-string path
  has a bound at all, not because it is expected to bind.
- `countTokens` returns `Promise<number | null>`. `null` means **above the cap,
  deliberately not measured** — never zero, never an estimate.

### 4.3 `@megasaver/context-gate` — `record-output.ts`

- **Keep** the `Promise.race`, renamed `ENCODING_LOAD_BUDGET_MS` with a
  corrected comment. The race was never wrong about the load: `loadEncoding()`
  is genuinely async, so while it is pending the event loop is free and the
  timer can fire. It was only wrong to *claim* it bounded the encode. Its
  500 ms value stays — sized above a measured cold start of 101–132 ms.
  Deleting it would remove the one thing it does correctly.
- `null` from either counter omits all three token fields.
- A **thrown** error remains a separate path. Conflating "we chose not to
  measure" with "measurement broke" would hide a genuine tokenizer bug behind
  an expected condition.

### 4.4 `@megasaver/bench-replay` — `token-divergence.ts`

Excludes `null` rows from the divergence sample rather than reading them as
zero. An offline analysis that silently averages in zeros would understate
divergence.

## 5. Non-goals

- Making the omitted rows measurable by another means. An extrapolation in a
  field named `rawTokens` violates the standing rule that such a value is
  measured or absent.
- Changing `estimateTokens` or the bytes/4 gate. Those are cheap and unaffected.
- Any user-facing output change. `measuredTokenCoverage` already computes the
  measured fraction per row and `mega audit honest` already prints
  `token source: N% measured, M% bytes/4 estimate`. Omitted rows flow into the
  existing line. Coverage on repetitive workloads will visibly drop — that is
  the honest report of a real gap, not a regression.

## 6. Rejected alternatives

| alternative | why rejected |
|---|---|
| Same-character-run detector | Measured: misses periods 2–16, each seconds-slow at 10 KB (§3.1). Worse than today. |
| `worker_threads` offload | Breaks determinism (§4.1); pays a multi-MB ranks load per worker on a per-tool-call hook; does not reduce work, only relocates an unbounded stall. |
| Lower `CHUNK_SIZE` alone | A constant factor, not a ceiling. 4 MB of repeated characters still takes 38 s. |
| Raise `TOKEN_COUNT_BUDGET_MS` | The guard is structurally dead; no value fixes it. |
| Fall back to `estimateTokens` above the cap | Puts an estimate in a field whose contract is "measured or absent". |

## 7. Testing

Fixture table covering ordinary text, TypeScript, varied hex, minified JSON,
base64, periods 1/2/3/8/16, and random content.

**Property:** for every shape at sizes spanning both caps, `countTokens` either
completes within the ceiling or returns `null`. Never exceeds the ceiling and
returns a number.

**Mutations that must fail:**

| # | mutation | must break |
|---|---|---|
| 1 | `MAX_REPETITIVE_CHARS` → 400,000 | worst-case timing assertion |
| 2 | `return null` → `return 0` | coverage assertion (a capped row must not read as a measured zero) |
| 3 | `CHUNK_SIZE` → 1000 | worst-case timing bound on the period-16 fixture |
| 4 | `longestRun` → same-character run | period-8 fixture timing (guards §3.1 against re-proposal) |
| 5 | `null` omission → zero-fill in `record-output` | `measuredTokenCoverage` assertion |

Mutation 4 exists specifically so the refuted detector cannot be reintroduced
without a red test.

**Timing assertions must be ratio-based, not absolute**, so they do not turn
red on slower CI hardware: assert the period-16 fixture costs no more than a
fixed multiple of the same-size varied-hex fixture measured in the same run.

## 8. Open questions for architect / critic

1. Is 3× machine-speed headroom the right margin, or should the caps be
   calibrated once at first use and stored? Calibration would reintroduce
   machine-dependence, which §4.1 rejects — but a fixed cap is a guess about
   the slowest machine anyone runs this on.
2. `MAX_MEASURABLE_CHARS` at 4 MiB is derived from ordinary-text rate. Is there
   a whitespace-containing shape that defeats `longestRun` and is still slow?
   §3.1 tested whitespace-free shapes only.

## 9. Definition of Done

Per §9, plus: the four measurement tables in this spec reproduced on the
implementer's machine, and `saver-run.test.ts` wall-clock recorded before and
after.
