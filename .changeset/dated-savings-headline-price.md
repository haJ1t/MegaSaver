---
"@megasaver/stats": minor
---

Date the headline dollar figure. `packages/stats/src/savings-headline.ts` held
its own copy of the input rate — `INPUT_PRICE_PER_MTOK_USD = 3.0`, a bare
literal — and `savingsFootnote()` rendered
`(est. at $3/M input; …)` with **no capture date**. That footnote is what the
CLI audit line (`apps/cli/src/commands/audit/shared.ts:89`) and both GUI
surfaces (`overview-page.tsx:211,231`, `workspace-session-list.tsx:298`) print
next to the `$` a user actually reads, so the most-seen dollar figure in the
product was the one undated pricing claim.

Meanwhile the repo already enforced provenance on the path *fewer* users reach:
`MODEL_LIST_PRICES` carries `capturedAt`, `loadModelPriceTable` rejects a table
without it (`missing_capture_date`), and `mega audit --honest` renders
"published list input rates, captured 2026-08-01". Two pricing sources, one
gate.

Now one source. `INPUT_PRICE_PER_MTOK_USD` is derived —
`inputPricePerMTok(MODEL_LIST_PRICES, undefined).usd` — and the new
`INPUT_PRICE_CAPTURED_AT` export carries `MODEL_LIST_PRICES.capturedAt`
alongside it. The footnote reads:

```
(est. at $3/M input, published list rate captured 2026-08-01; saved tokens
were never sent, so not cache-discounted.)
```

**No user-visible number changes.** The dated table's fallback model is
`claude-sonnet-5` at `$3.0/MTok`, exactly the literal that was there — this
swaps the provenance, not the price. The `(est.)` labelling and the
"not cache-discounted" caveat are untouched.

Breaking (pre-1.0): `savingsFootnote(rate)` is now
`savingsFootnote(rate, capturedAt)`. `capturedAt` is required rather than
defaulted on purpose — a caller pricing at its own rate would otherwise inherit
this module's date and stamp the wrong provenance on a figure that did not come
from this table. The only in-repo call site is `SAVINGS_FOOTNOTE` itself;
`packages/core/src/context-gate.ts` re-exports the function unchanged.

The alignment pin in `packages/stats/test/savings-headline.test.ts` went
tautological once the constant was derived from the table it was pinned
against, so it is joined by literal pins on both `3.0` and `2026-08-01`:
editing the price table reprices every headline `$` in the CLI and GUI, and
that must fail a test and be re-approved, not ride along as a table edit.

Two follow-ups this does not close. First, `formatSavingsHeadlineLines`
(`apps/cli/src/commands/audit/shared.ts:89`) always prints the module-level
`SAVINGS_FOOTNOTE` while the `$` beside it comes from
`opts.inputPricePerMTok` when a caller overrides the rate. No production caller
overrides today (only a test passes `{ inputPricePerMTok: 15 }`), so this is
pre-existing — but the mismatch is now worse in kind, because an overriding
caller would get a wrong rate *plus* a capture date lending it authority. The
fix is to thread the rate and date together, or to derive the footnote from the
headline rather than from the module constant.

Second, still undated: `apps/cli/src/commands/cache.ts:245` and
`packages/pro-analytics/src/{bench,teardown}.ts` each build their own rate
string from `INPUT_PRICE_PER_MTOK_USD` without a date. They can now import
`INPUT_PRICE_CAPTURED_AT` from `@megasaver/stats`.
