---
"@megasaver/stats": minor
"@megasaver/gui": minor
---

Savings share card: the product generates its own shareable savings image.

The savings screenshot is the niche's native currency, so MegaSaver becomes its
own ad creative. A new pure `renderSavingsCardSvg(headline, { windowLabel })`
turns a `SavingsHeadline` into a 1200×630 direction-B card (minimal editorial:
light `#f6f5f2` ground, dark `#17181a` ink, one big `$` number, "Mega Saver"
mark, three sub-stats, footer "Less tokens. More signal."). It lives in the
browser-safe `@megasaver/stats/headline` barrel so the GUI and a future
`mega share` reuse one renderer; all text derives from the real headline (no
invented numbers), carries `(est.)`, and untrusted window labels are escaped.

- New GUI **Share** button beside the savings strip, shown only when
  `bytesSavedTotal > 0`. It opens a modal previewing the card and exporting it:
  **Download PNG** (zero-dep SVG→canvas→`toBlob`), best-effort **Copy image**
  (guarded when the clipboard API is missing), and **Share on X** (a tweet-intent
  whose honest, `(est.)`-carrying text comes from the same `computeSavingsHeadline`
  — one source, no overstatement). X can't auto-attach the image, so the modal
  tells the user to download the card then attach it.
