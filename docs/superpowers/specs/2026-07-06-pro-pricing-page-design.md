---
title: Pro pricing page (site/pro.html at /pro)
date: 2026-07-06
status: approved
risk: LOW
scope: a static marketing/pricing page for Mega Saver Pro at the URL the CLI already advertises
base: main (9a47aaf8)
reviewers: [design-critique, content-accuracy critic, a11y/CSP check]
manual-confirmation: given (user approved 2026-07-06; price + purchase flow locked below)
---

# Pro pricing page — `site/pro.html`

## Why this URL is fixed

The free CLI's upsell already points at `https://megasaver.dev/pro`
(`PRO_ANALYTICS_URL` in `apps/cli/src/commands/savings/shared.ts`). A user who
runs `mega savings history`/`insights` without a license is told "Learn more:
https://megasaver.dev/pro." So the page **must** live at `site/pro.html` (served
at `/pro`) — it is the destination the product already ships.

## Locked decisions (user-approved 2026-07-06)

1. **Price: $7.99/mo.** Single monthly price (no annual tier for launch).
2. **Purchase: external payment link (Gumroad/Lemon Squeezy).** The CTA links to
   a Gumroad product; after checkout the buyer receives a license key by email
   and activates with `mega license activate <key>`. The real product URL is the
   owner's to create — the page ships a clearly-commented placeholder link the
   owner swaps. Stripe/automated delivery stays deferred.

## Design system (inherited — do NOT invent a new one)

Mirror `site/index.html` exactly (Direction B, light editorial):
`--paper:#f1f2ef` · `--ink:#17181a` · `--muted:#5c5f5a` · `--hair:#dcdcd6` ·
`--accent:#0e7a54` · terminal `--term:#17181a`/`--term-ink:#e8e9e4`. System sans +
`ui-monospace` (mono = the data/identity face). `--maxw:1080px`. Reuse the site's
components verbatim: `nav`, `.brand`/`.sq`, `.label` eyebrows, `.install`
terminal pill, `.ghost` outline button, `section`/`.sec-head`, `.feat`/`.card`
grid, `.reveal` animations, `focus-visible`, the `@media(max-width:720px)` rules.
Self-contained (inline CSS, no external fonts/CDN — CSP-clean like index.html).

## Page content (accurate — no overclaiming)

1. **Head** — `<title>Mega Saver Pro — deeper savings analytics</title>`, meta
   description, `<link rel=canonical href=https://megasaver.dev/pro>`, OG/Twitter
   (reuse `/og.png`), the accent-square favicon from index.html.
2. **Nav** — same brand; a "← Mega Saver" link home (`/`), `github ↗`. Signals
   this is a sub-page of the same site.
3. **Hero** — eyebrow `MEGA SAVER PRO`; h1 e.g. "Know where your tokens still
   go."; sub: the free core already saves tokens and shows your running total —
   **Pro adds the analytics on top**: history, per-project, and a waste/efficiency
   breakdown. Price shown prominently: **$7.99/mo**.
4. **What Pro unlocks** — two cards, describing EXACTLY the shipped modules:
   - `mega savings history` — time-series savings by day / week / project, with
     CSV / JSON export.
   - `mega savings insights` — a waste/efficiency breakdown: where tokens are
     still spent, by source/tool, with per-source saving ratios (diagnostic).
   Framed as "on top of the free core," never as if the core saving is paywalled.
5. **Free vs Pro** — an honest comparison built from the `.feat`/`.card` or a
   two-column table:
   - **Free (MIT):** evidence-preserving compression, cross-agent memory,
     decision-trace, the *current* cumulative savings total, local-first.
   - **Pro ($7.99/mo):** everything in Free **plus** historical trends,
     per-project breakdown, waste/efficiency insights, CSV/JSON export.
   The core token-saving is free; Pro is the analytics layer.
6. **Price + CTA** — `$7.99 /mo` (accent), a primary button "Get Mega Saver Pro
   →" linking to the Gumroad placeholder, and a `.install` pill showing
   `mega license activate <key>`. Sub-note: "After checkout you'll get a license
   key by email. Activate it with one command." Honest interim line: keys are
   delivered via Gumroad today; automated (Stripe) checkout is coming.
7. **Honesty disclosure** (on-brand — the whole site is about honesty): the gate
   lives in open-source code, so it is technically bypassable — we don't pretend
   otherwise. What is unforgeable is the key: licenses are Ed25519-signed offline;
   honest users pay for a real key (the Sublime/Obsidian model). No security
   theater.
8. **Footer** — identical to index.html (MIT note, estimate disclaimer,
   not-affiliated line).

## Verification

- Renders in a browser (preview): hero, cards, comparison, price/CTA, disclosure,
  footer; matches Direction B; responsive at 375px (nav links collapse, grids
  stack); focus-visible on links/buttons.
- All internal links resolve (`/`, `/#how`, GitHub); the Gumroad link is a
  commented placeholder the owner swaps; no external CSS/JS/font requests (CSP).
- **Content accuracy:** every claim matches what the CLI actually does — the two
  modules are described truthfully; the core-is-free / Pro-is-analytics framing
  is not misleading; no invented benefits.

## Non-goals

Annual pricing; Stripe/automated key delivery; a real Gumroad product (owner
creates it); a customer login/portal; changing the CLI upsell text.
