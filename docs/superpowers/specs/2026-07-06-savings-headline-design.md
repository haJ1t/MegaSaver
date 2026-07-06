---
title: Savings headline — $ + limit-headroom, the visible value number
date: 2026-07-06
status: proposed
risk: MEDIUM
scope: a pure computeSavingsHeadline fn (token→$ + context-reclaimed) + surface it on the GUI home strip + mega audit report
base: main (f66d02bb)
reviewers: [code-reviewer, critic]
---

# Savings headline

## Motivation (GTM Faz 0 — make the value VISIBLE)

MegaSaver already computes tokens saved (`WorkspaceTokenSaverTotals.bytesSavedTotal`)
but the number is invisible until you run an audit command, and it's shown as
raw bytes/tokens — not a value a person feels. The GTM plan's Faz-0 headline:
a cumulative **"≈$X saved (est.) · ≈Z sessions' worth of context reclaimed"** on
the GUI home + the `mega audit report` output.

## Locked decisions (user-approved 2026-07-06)

1. **Dual framing**: $ AND limit-headroom together (Pro/Max feel limits, API feel
   $ — cover both).
2. **Fixed representative input price + "(est.)" label**; model-override deferred.

## Honesty foundation (why these numbers are defensible)

Token-saver savings are tool-output tokens that were **compressed away and never
sent to the model** — so, unlike the conversation proxy's $ (which is discounted
by prompt caching), these saved input tokens were never subject to caching. The
"$ would-have-paid" estimate is therefore cleaner than a proxy-metered figure.
The one assumption is the per-model input price — hence the **(est.)** label and a
one-line footnote stating the assumption. No overstatement, no cache double-count.

## Design

### 1. Pure `computeSavingsHeadline` — `@megasaver/stats`

```
INPUT_PRICE_PER_MTOK_USD = 3.0     // representative Anthropic input rate (Sonnet-class); (est.)
CONTEXT_WINDOW_TOKENS    = 200_000 // one full context window = "a session's worth"

computeSavingsHeadline(totals: { bytesSavedTotal: number; sessionsCount: number; savingRatio: number },
                       opts?: { inputPricePerMTok?: number }): SavingsHeadline

SavingsHeadline = {
  tokensSaved: number,              // tokensFromBytes(bytesSavedTotal)
  dollarsSaved: number,             // tokensSaved / 1e6 * inputPrice  (est.)
  contextWindowsReclaimed: number,  // tokensSaved / CONTEXT_WINDOW_TOKENS — "≈Z sessions' worth"
  savingRatio: number,              // passthrough
  isEstimate: true,                 // always — the $ is a modeled estimate
}
```

- `tokensSaved` reuses `tokensFromBytes` (the existing bytes/4 model) — one token
  model across the product.
- `dollarsSaved` rounds for display at the render layer, not in the pure fn
  (keep the fn lossless).
- `contextWindowsReclaimed` uses the full 200K window as the divisor (the
  conservative, defensible "one session's worth" upper bound — a real session
  rarely fills 200K, so this UNDER-counts sessions, which is the honest direction).

### 2. All-workspace aggregation — `@megasaver/stats`

The GUI home headline is cumulative across ALL workspaces. Add
`readAllWorkspaceTokenSaverTotals(store): { bytesSavedTotal; sessionsCount;
savingRatio; workspaceCount }` that sums the per-workspace totals
(`readWorkspaceTokenSaverTotals` exists; iterate the workspace dirs under the
stats store, sum bytesSavedTotal + sessionsCount, recompute the blended ratio).
Best-effort: an unreadable workspace is skipped, never fatal.

### 3. CLI surface — `mega audit report`

`audit-summary` already yields `tokensSaved` per window (session|week|all). Add a
headline line to the report renderer:
`Saved ≈<tokensSaved> tokens ≈ $<dollarsSaved> (est.) · ≈<contextWindowsReclaimed>
sessions' worth of context (200K each).` Plus a one-line footnote: `(est. at
$3/M input; saved tokens were never sent, so not cache-discounted.)`. `--json`
includes the SavingsHeadline object.

### 4. GUI surface — home summary strip

`apps/gui/src/views/workspace-session-list.tsx` (the strip currently shows
Workspaces/Sessions/Live) gains a cumulative savings headline: fetch the
all-workspace totals via a bridge route (extend the existing token-saver route
group with `GET /api/token-saver/all-workspaces` → `readAllWorkspaceTokenSaverTotals`
→ send the totals; the client computes `computeSavingsHeadline` OR the bridge
computes it — prefer the bridge returns the raw totals and the client computes
the headline so the price const lives in one place shared with the CLI). Render:
`≈$<Y> saved (est.) · ≈<Z> sessions reclaimed` with a hover/footnote explaining
the estimate. Empty (no savings yet) → an honest "No savings recorded yet —
enable the saver to start." (no fake $0 flex).

## Non-goals (deferred)

Weekly-digest PUSH (OS notification / CLI banner / scheduling) — this iteration
surfaces the number where the user already looks; the retention push is a
fast-follow. User-configurable model/price setting. Proxy-usage-based real $
(opt-in path). Per-model price table.

## Testing (TDD)

- **computeSavingsHeadline**: known totals → exact tokensSaved/dollarsSaved/
  contextWindowsReclaimed; a custom inputPricePerMTok overrides; zero savings →
  all zeros + isEstimate true. Mutation: wrong divisor (1M vs price) or wrong
  context const would change the asserted numbers.
- **readAllWorkspaceTokenSaverTotals**: a stats store with 3 workspaces → summed
  bytesSavedTotal + sessionsCount + blended ratio; an unreadable workspace
  skipped, rest intact.
- **CLI**: `mega audit report --window week` renders the headline line + footnote;
  `--json` carries the SavingsHeadline; zero savings → honest line.
- **GUI**: bridge route returns the all-workspace totals; the strip renders the
  headline when savings exist and the honest empty copy when not.
- `pnpm verify` green; a real smoke: run a compressed read, then `mega audit
  report` shows the $ headline.

## Slices

- **A**: `computeSavingsHeadline` + `readAllWorkspaceTokenSaverTotals` (pure core).
- **B**: `mega audit report` headline line + footnote + `--json`.
- **C**: GUI bridge route + home-strip headline + empty state.
