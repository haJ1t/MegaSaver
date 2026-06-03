---
"@megasaver/gui": patch
---

Fix WCAG 2.1 AA color-contrast failures in two GUI design tokens.

`--color-accent` (light) darkened `#c4681a` → `#a25616` so `text-accent`
(status labels, links, Retry) clears 4.5:1 on every surface and the
primary button label (white on accent) clears 4.5:1. `--color-text-muted`
darkened in light `#9ea3ad` → `#646b77` and lightened in dark
`#565b66` → `#8b909d` so secondary/instruction text clears 4.5:1 in both
themes. Hue and saturation preserved (warm amber / neutral grey); the dark
accent already passed AA and is unchanged. CSS token values only.
