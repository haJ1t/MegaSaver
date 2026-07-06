# Mega Saver marketing site

Static, dependency-free pages — no build step, no JS framework (one inline CSS
reveal animation, honored only when `prefers-reduced-motion` allows). Deploy the
`site/` directory to any static host.

- `index.html` — landing page (`/`).
- `pro/index.html` — Pro pricing page (`/pro`). Lives in a `pro/` folder so the
  clean URL `/pro` resolves on every static host (including GitHub Pages), which
  is the URL the CLI's upsell already advertises (`PRO_ANALYTICS_URL`).

## Deploy

- **GitHub Pages** — Settings → Pages → deploy from `main` / `site`.
- **Vercel** — import the repo, set the root/output dir to `site`, no build
  command.
- **Netlify** — publish directory `site`, no build command.

## Before launch (owner)

1. **Domain** — set the real domain in `index.html` **and** `pro/index.html`:
   `<link rel="canonical">`, `og:url`, `twitter` + `og:image` absolute URLs
   (currently `https://megasaver.dev/…`, a placeholder). Buy + point DNS at the host.
2. **`site/og.png`** — a 1200×630 brand share image ships here already
   (direction-B, no fake numbers). Swap in a real savings-card screenshot later
   if you want the link to unfurl with live numbers.
3. **Pro checkout link** — `pro/index.html` links the "Get Mega Saver Pro" CTA to
   a placeholder Gumroad URL (`megasaver.gumroad.com/l/pro`, marked with an HTML
   `TODO owner` comment). Create the real Gumroad/Lemon Squeezy product and swap
   the URL before launch.
4. **Real license key** — the CLI ships a *placeholder* Ed25519 public key
   (`packages/entitlement/src/public-key.ts`) whose private key was discarded, so
   no key validates yet. Run `scripts/license/gen-keypair.mjs`, keep the private
   key offline, and paste the real public SPKI PEM into `public-key.ts` before
   selling — otherwise a paying customer cannot activate.

## Design

Direction-B editorial (matches the in-product savings share card): cool-paper
ground, ink text, monospace as the data/identity face, a single deep-signal-green
accent on the savings number + brand mark. The hero demo shows the product's
thesis literally — a raw tool-output block compressed to its signal, with "full
output recoverable". Copy carries the same honesty discipline as the product: the
dollar figure is labeled `(est.)`, floored, never rounded up.
