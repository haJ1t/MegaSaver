---
"@megasaver/stats": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Savings headline: surface saved tokens as a visible, defensible value.

MegaSaver already computed tokens saved but showed them only as raw bytes/tokens
buried in an audit command. This turns that number into a value a person feels:
a cumulative `≈$X saved (est.) · ≈Z sessions' worth of context reclaimed` on the
GUI home strip and the `mega audit report` output.

- **@megasaver/stats**: new pure `computeSavingsHeadline` (byte entry) +
  `savingsHeadlineFromTokens` (token entry) share one price/window model —
  `INPUT_PRICE_PER_MTOK_USD = 3.0` and `CONTEXT_WINDOW_TOKENS = 200_000`. Tokens
  reuse the existing `tokensFromBytes` (bytes/4) model. New
  `readAllWorkspaceTokenSaverTotals` aggregates every workspace with a blended
  ratio for the cumulative headline. A browser-safe `@megasaver/stats/headline`
  subpath lets the GUI client import the const without pulling the node store.
- **@megasaver/cli**: `mega audit report` renders a `$` headline line + a
  one-line footnote after the summary, and carries the `SavingsHeadline` object
  under `--json`. Zero savings renders an honest
  `No savings recorded in this window yet.` — never a fake `$0.00` flex.
- **@megasaver/gui**: a new `GET /api/token-saver/all-workspaces` bridge route
  returns the summed totals; the home strip renders
  `≈$X saved (est.) · ≈Z sessions reclaimed` with the estimate assumption in a
  hover footnote, and an honest `No savings recorded yet — enable the saver to
  start.` empty state.

Honesty: the `$` is always labeled `(est.)` because the one modeled assumption is
the per-model input price. Saved tokens were compressed away and never sent, so —
unlike the conversation proxy's `$` — they carry no prompt-cache discount to
double-count. The 200K-per-session divisor deliberately UNDER-counts real
sessions (a session rarely fills 200K), so reclaim is never overstated.
