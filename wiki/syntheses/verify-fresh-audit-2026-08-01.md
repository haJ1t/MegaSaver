---
title: Fresh-verify audit — the tokenizer is quadratic on repeated-character runs
tags: [audit, performance, verify, saver, tokenizer, regression]
sources: [packages/context-gate/src/record-output.ts, packages/output-filter/src/tokens.ts, apps/cli/test/hooks/saver-run.test.ts]
status: superseded
created: 2026-08-01
updated: 2026-08-05
---

> **Superseded 2026-08-05.** The defect this page found is FIXED; see
> `docs/superpowers/specs/2026-08-05-saver-token-count-bound-design.md`.
> `pnpm verify` is green on the fix branch (60/60, `turbo test --force`). Two
> parts of this page aged differently, so read it with that split in mind:
>
> - **§"The guard cannot work" was correct and was the whole finding.**
>   `TOKEN_COUNT_BUDGET_MS` could never fire because the encode is synchronous.
>   That is exactly what the fix addresses.
> - **§Impact is stale.** "`pnpm verify` is RED on `main`" no longer holds, and
>   the 539.71 s / 500 s figures predate the chunk guard of `32846bfd`.
> - **The root cause was narrower than stated.** "Quadratic BPE merging on
>   repeated-character runs" is one instance. Measured 2026-08-05, cost is
>   quadratic in the UTF-8 byte length of each *regex match*, so it is not
>   about repeated characters at all: 32 KB of newlines takes 46 s (one
>   whitespace match), and 8k chars of ordinary Japanese take 24 s. Neither
>   repeats a character.
> - **Both fix directions below were superseded.** The shipped fix is neither:
>   it bounds `(4 + maxMatchBytes) * totalBytes` over the encoder's own split
>   partition, read from `encoding.patStr`.

Closes the question left open by the 2026-08-01 retraction in [[log]]: *"whether
`pnpm verify` has ever passed FRESH on this machine."*

## Answer at the time: no. It failed, and the cause was a two-commit-old regression.

Cache-bypassed (`--force`, `Cached: 0 cached`) run of all four verify legs:

| Leg | Result |
|---|---|
| `biome check` | pass — 1897 files |
| `build` + `typecheck` | pass — `60 successful, 60 total`, `Cached: 0 cached`, 26.11 s |
| `conventions:check` | pass — 5/5 ok |
| `test` | **FAIL** — `Tasks: 59 successful, 60 total`; `@megasaver/cli#test` exits 1 |

The CLI failure has **zero failing tests**: `Tests 1475 passed | 7 skipped`,
`Type Errors no errors`, `Errors 2 errors`. The exit-1 comes only from two
unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` rejections.

## Root cause (measured, not inferred)

`countTokens` entered the saver write path in `9c959fcb` (2026-08-01); the
budget was raised 50→500 ms in `d2a46141` on the belief that the cost was
*tokenizer cold start*. It is not. It is **quadratic BPE merging**.

- CPU profile of one 50 KB call: **96.00 s self-time (96.4%) in
  `bytePairMerge`** (js-tiktoken). Every regex in the run is ≤0.03 s — this is
  **not** an instance of [[concepts/unbounded-run-redos]].
- `filterOutput` alone: **101 ms**. `recordAndFilterOverlayOutput`: **99,362 ms**.
  The whole cost is the new token-measurement step, not the pipeline.
- Growth ratio at a 4× size step (per [[concepts/redos-growth-ratio-measurement]]):

  | input shape | 64 KB | ratio | verdict |
  |---|---|---|---|
  | `"X".repeat(n)` | 152,743 ms | **16.0, 16.2** | quadratic (k²) |
  | base64, no whitespace | 37.8 ms | 2.6–4.8 | linear |
  | base64, space-separated | 32.9 ms | 3.3 | linear |
  | ordinary log text | 3.2 ms | 4.0 | linear |

  Scaling predicts the observed value: (50/64)² × 152.7 s ≈ 93 s vs 96 s measured.

**Trigger is a long run of the SAME character** — *not* absence of whitespace.
High-entropy whitespace-free input (base64) is linear. An earlier guess in this
investigation that minified/base64 payloads were exposed was measured and
refuted.

## The guard cannot work

`record-output.ts:398` races the counter against `setTimeout(500)`. Its own
comment says *"Bounds the WAIT, not the work."* But `countTokens` is `async`
only for the lazy `import("js-tiktoken")`; after memoization
`encoding.encode()` is **synchronous** (`tokens.ts:39`). Synchronous work holds
the event loop, so the timer callback cannot run until the tokenizer returns.
**`TOKEN_COUNT_BUDGET_MS` can never fire.** Same fact from the other side: a
test declaring `30_000` ms timed out but reported a **125,753 ms** duration —
the timeout fired ~4× late because the loop was blocked.

`tokens.ts:26` already warned that `estimateTokens` "must never pay the multi-MB
ranks load" on the hot path. The telemetry lane put the real tokenizer back onto
that exact hook path.

## Impact

- **Certain / present:** `pnpm verify` is red on `main`. `@megasaver/cli` takes
  539.71 s; `saver-run.test.ts` alone burns **500 s user CPU at 95%** (so the
  earlier "parallel contention" theory is rejected — it is intrinsic).
- **Production, conditional:** the PostToolUse saver runs per tool call. Any tool
  output carrying a ≥10 KB run of one repeated character (zero-padded base64,
  hex dumps of zeroed regions, separator/progress spam) blocks the agent for
  minutes, with the budget unable to intervene.

## Fix direction — TWO candidates, both pre-spec, neither measured

1. **Move tokenization off the loop** (`worker_threads`) so the existing timer
   can actually fire. Makes the budget contract real for *every* slow case, not
   just this one. Heaviest change.
2. **Bound the input instead of the wait** — a size cap or run-length pre-check
   that OMITS the token fields rather than paying for them. The schema already
   permits this: `record-output.ts:388` says *"a value in a field named
   rawTokens is measured or absent"*, and `tokens.ts:26` already states the
   intended design (`estimateTokens` on the hot path, real BPE off it). Cheaper,
   and honest — an omitted field is not an estimate wearing a measurement's name.

No recommendation here on purpose: neither has been measured, and picking a
winner from reasoning alone would anchor the spec author. Risk is HIGH (saver
core path) → spec + `architect` + `critic` per
[[concepts/risk-aware-development]].
