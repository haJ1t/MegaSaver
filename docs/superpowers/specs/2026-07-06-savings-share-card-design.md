---
title: Savings share card — a shareable image the product generates
date: 2026-07-06
status: proposed
risk: MEDIUM
scope: pure renderSavingsCardSvg (direction B) + GUI Share button → PNG export + X intent
base: main (14b2c6cd)
reviewers: [code-reviewer, critic]
---

# Savings share card

## Motivation (GTM Faz 0 — the content engine)

The niche's native currency is the savings screenshot (ccusage went viral as a
scorecard; the $81k bill-shock made global news). So MegaSaver should generate
its OWN shareable savings image — the product becomes its own ad creative. Built
on the savings-headline data just shipped.

## Locked decisions (user-approved 2026-07-06)

1. **Direction B — minimal editorial.** Light `#f6f5f2` ground, dark `#17181a`
   text, one big `$` number, "Mega Saver" mark, sub-stats, footer "Less tokens.
   More signal." Reads as a serious tool, broad appeal — not a flex.
2. **Surface: GUI Share button → PNG.** The card is an SVG rendered in-browser;
   export to PNG via canvas (zero-dep — the browser does SVG→PNG for free) plus a
   "Share on X" tweet-intent. `mega share` CLI deferred (same SVG renderer reusable).

## Design

### 1. Pure `renderSavingsCardSvg` — `@megasaver/stats/headline` (browser-safe)

```
renderSavingsCardSvg(headline: SavingsHeadline, opts: { windowLabel: string }): string  // an <svg> string
```

- 1200×630 (X / OG standard). Direction B palette. All text derived from the
  real `SavingsHeadline` — no invented numbers:
  - Big: `$<dollarsSaved.toFixed(2)>` + a small `(est.)`.
  - Line: `saved <windowLabel>` (e.g. "this week" / "all time").
  - Sub-stats: `<tokensSaved> tokens saved` · `<savingRatio%> reduction` ·
    `≈<contextWindowsReclaimed.toFixed(1)> sessions' worth reclaimed`.
  - Mark: "Mega Saver" + the square dot. Footer: "Less tokens. More signal."
- Honest: the `(est.)` qualifier is ON the card (same discipline as the headline).
- Lives in the browser-safe `/headline` subpath (no `node:fs`), so the GUI imports
  it and a future `mega share` can reuse it. Deterministic (no Date/random — the
  window label is passed in).

### 2. GUI Share button + card modal — `apps/gui`

- A **Share** button beside `SavingsHeadlineStrip` (`workspace-session-list.tsx`),
  shown only when there are savings (`bytesSavedTotal > 0`).
- Click → a modal previewing the rendered card (the SVG inline) + actions:
  - **Download PNG** — SVG string → `Image` (data-URL) → `<canvas>` → `toBlob` →
    download `megasaver-savings.png`. Zero dep.
  - **Copy image** — the same blob to the clipboard (`navigator.clipboard.write`),
    best-effort (guard unsupported → hide/disable).
  - **Share on X** — `window.open("https://twitter.com/intent/tweet?text=" +
    encodeURIComponent(text))` where text is honest + pre-filled, e.g.
    `Saved ≈$<X> of tokens with Mega Saver — less tokens, more signal. (est.)`.
    (X's intent cannot auto-attach an image, so the flow is: download the PNG, then
    the intent opens with the text — the modal says "download the card, then it's
    attached to your post" honestly.)
- The card + PNG carry the same `(est.)` honesty as the headline; the tweet text
  too. No overstatement.

## Non-goals (deferred)

`mega share` CLI (the SVG renderer is reusable when it lands); the other two card
directions; user-editable card text; auto-attaching the image to X (platform
limitation); animated/video cards.

## Testing (TDD)

- **renderSavingsCardSvg**: a known `SavingsHeadline` → the SVG string contains the
  `$` value, tokens saved, reduction %, sessions reclaimed, "Mega Saver", "Less
  tokens. More signal.", and `(est.)`; it parses as valid XML/SVG; deterministic
  for the same input; zero savings is not rendered (the button is hidden, but the
  fn on zero still produces a valid `$0.00` card if called — guarded at the call
  site, not the fn).
- **GUI**: the Share button shows only when savings > 0; clicking opens the modal
  with the card; Download invokes the canvas→blob path (mock canvas/URL.createObjectURL);
  the X-intent opens with the honest, `(est.)`-carrying text; Copy guards unsupported
  clipboard.
- `pnpm verify` green; a real visual check: build the GUI, open it, confirm the
  rendered card matches direction B and the PNG downloads.

## Slices

- **A**: `renderSavingsCardSvg` (pure, direction B) + tests.
- **B**: GUI Share button + card modal + PNG export + Copy + X intent + tests.
