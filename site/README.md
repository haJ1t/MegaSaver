# Mega Saver landing page

Static, single-file marketing page — `index.html`. No build step, no
dependencies, no JS framework (one inline CSS reveal animation, honored only
when `prefers-reduced-motion` allows). Deploy the `site/` directory to any static
host.

## Deploy

- **GitHub Pages** — Settings → Pages → deploy from `main` / `site`.
- **Vercel** — import the repo, set the root/output dir to `site`, no build
  command.
- **Netlify** — publish directory `site`, no build command.

## Before launch (owner)

1. **Domain** — set the real domain in `index.html`: `<link rel="canonical">`,
   `og:url`, `twitter` + `og:image` absolute URLs (currently
   `https://megasaver.dev/`, a placeholder). Buy + point DNS at the host.
2. **`site/og.png`** — add a 1200×630 share image (the savings share card render
   is a natural fit) so links unfurl with a card on X / Slack / etc.

## Design

Direction-B editorial (matches the in-product savings share card): cool-paper
ground, ink text, monospace as the data/identity face, a single deep-signal-green
accent on the savings number + brand mark. The hero demo shows the product's
thesis literally — a raw tool-output block compressed to its signal, with "full
output recoverable". Copy carries the same honesty discipline as the product: the
dollar figure is labeled `(est.)`, floored, never rounded up.
