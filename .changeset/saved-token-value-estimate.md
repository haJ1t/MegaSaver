---
"@megasaver/context-gate": minor
"@megasaver/stats": minor
"@megasaver/cli": patch
---

Saved tokens are measured at the write site and priced from a dated list-price
table (child-spec #3). `recordAndFilterOverlayOutput` counts the raw and
returned text as it records, writing `rawTokens`, `returnedTokens` and
`deltaTokens` onto the overlay event; `RecordOverlayOutputInput` accepts an
optional `countTokensImpl` seam. On timeout the three fields are **omitted
rather than zeroed**: a value in a field named `rawTokens` is measured or
absent, never inferred. `TOKEN_COUNT_BUDGET_MS` (500 ms) bounds only the lazy
`js-tiktoken` load, which is the async part — it was sized above a measured
cold start of 101–132 ms. It does **not** bound `encode` itself, which is
synchronous and holds the event loop, so the race cannot interrupt it:
measured post-guard, 400 KB of repeated characters returns a value after
14,388 ms without the budget firing. Pathological input remains unbounded on
this path. The stats event schema gains optional `modelId` and `isFreshStore`.

`@megasaver/stats` exports the reading and pricing surface: `deltaTokensOf` and
`measuredTokenCoverage`, with `observationsFromEvents` preferring a measured
raw/returned pair over the bytes/4 fallback per row; `modelPriceTableSchema`,
`ModelPriceTable`, `loadModelPriceTable`, `inputPricePerMTok`, `ResolvedPrice`,
`PriceTableError`, `PriceTableErrorCode` and `MODEL_LIST_PRICES`;
`estimateSavedValue` with `ValuedRow` and `SavedValueEstimate` (which carries
`fallbackModelId` and `fallbackInputPerMTokUsd`); and `resolveModelId` with
`ModelResolutionInput` and `ProxyModelRow`, built but wired to nothing —
`estimateSavedValue` shares are computed on magnitude, so a window that is half
unknown cannot report 0% unknown by netting out. `MODEL_LIST_PRICES` duplicates
`scripts/model-list-prices.json` because the CLI bundle cannot read `scripts/`;
a test pins the two together, and a second test pins the older
`INPUT_PRICE_PER_MTOK_USD` to the table's fallback rate so the two dollar paths
cannot drift apart silently.

`mega audit honest` reports its token source (measured vs bytes/4 estimate) and,
below the token lines, the net measured tokens with an estimated dollar figure.
Two limits are printed, not buried: the figure is a **floor, not a cap** — a
saved token is never written into the prefix, so what is avoided is one cache
write plus a cache read on every later turn that would have carried it,
`p·(2.0 + 0.1N)` against the `p·1.0` reported — and the unknown-model share is
100% by construction, since nothing writes `modelId` today, so the line names
the fallback model and its rate inline rather than leaving the reader to guess
what price produced the number.
