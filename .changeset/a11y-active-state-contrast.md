---
"@megasaver/gui": patch
---

Fix WCAG 2.1 AA color-contrast (SC 1.4.3) on two GUI active/selected states in
light mode.

The active nav item (`bg-accent/15`, `aria-current="page"`) and the active
segmented "+ New …" chip (`bg-accent/20 border border-accent/30`) labelled
their text with `text-accent`. Composited over the page background, the amber
label cleared only 4.03:1 (nav) and 3.75:1 (chip) — below the 4.5:1 normal-text
threshold. The label colour is now `text-text-primary`, which composites to
13.6:1 (nav) and 12.6:1 (chip) in light and 13.8:1 / 12.4:1 in dark; every
state now passes AA in both themes. The accent tint fill, accent border, and
`font-medium` remain as the selected-state signal (SC 1.4.1 was already met by
fill + border + weight), so the visual language is unchanged. Component class
strings only; no token values changed.
