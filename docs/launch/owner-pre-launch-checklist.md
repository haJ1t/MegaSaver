# Mega Saver — Owner Pre-Launch Checklist

The Pro tier is built, reviewed, and merged: entitlement seam + three analytics
modules (`savings history` / `insights` / `forecast`) + the `/pro` pricing page.
Everything below is what **only you** can do — it needs your accounts, money,
keys, and business decisions. None of it is a code task an agent can finish for
you.

> Verified against the repo + npm on 2026-07-06. Re-check the "where things
> stand" facts before you act — they drift as you publish.

---

## Where things actually stand (verified)

- **`@megasaver/cli` IS on npm — but at v1.4.1, which is PRE-Pro.** That build
  (Jul 1) has no `savings` commands and carries the **placeholder** license key.
  `npm i -g @megasaver/cli` works, but installs a CLI that can't run Pro and
  can't validate any key. **Shipping Pro needs a version bump + republish.**
- **`megasaver.dev` is not registered** (NXDOMAIN). The published CLI hardcodes
  `https://megasaver.dev/pro` in its upsell, so the domain is effectively
  **locked** — buy megasaver.dev, or accept that already-installed CLIs point at
  a dead link.
- **No checkout exists.** The pricing page's "Get Mega Saver Pro" button is a
  placeholder Gumroad URL.
- **No license can validate.** The baked Ed25519 public key is a placeholder
  whose private half was discarded at generation.

---

## Two decisions to make first (they gate the release)

### Decision 1 — Proprietary code in the public tarball

On `npm publish`, the bundler (`tsup.bundle.config.ts` `noExternal`) **inlines
every workspace package into the tarball — including the proprietary
`@megasaver/pro-analytics`.** So every free `npm i` user downloads the readable
Pro source. It's disclosed (`apps/cli/NOTICE`), and this is the honest open-core
reality (the gate is bypassable; the license isn't).

**✅ DECIDED (2026-07-06): (A) Ship bundled + NOTICE.** Simplest; matches the
open-core honesty story; the signature, not the code, is the moat. A CRITICAL
licensing audit then hardened the disclosure so the mixed-license tarball is
airtight: the npm `license` field is now `SEE LICENSE IN NOTICE` (not a bare
`MIT` that would overclaim the bundled proprietary code); the MIT `LICENSE` and
the proprietary `PRO-LICENSE` both ship inside the tarball; and the `NOTICE` +
README wording all agree. Option (B) — splitting `pro-analytics` to a private
channel the CLI loads only under a valid license — remains a deferred refinement
if source protection later matters.

### Decision 2 — Domain

`megasaver.dev` is hardcoded in the shipped CLI. Recommended: **buy
megasaver.dev** (lowest friction, matches what's already out). If you want a
different name, decide NOW — before more installs — and republish the CLI with
the new URL.

---

## Phase 1 — Make Pro actually work (release)

1. **[BLOCKER · S] Generate the real license keypair.**
   `node scripts/license/gen-keypair.mjs` → keep the printed private key offline
   (gitignored `scripts/license/.private-key.pem`), paste the public SPKI PEM
   over the placeholder in `packages/entitlement/src/public-key.ts`. Do this
   **before** issuing any key — keys signed against the old placeholder never
   validate. *This is the #1 blocker.*
2. **[BLOCKER · M] Bump + republish the CLI.** From the repo root:
   `pnpm changeset version` (consumes the pending changesets → bumps
   `@megasaver/cli` 1.4.1 → 1.5.0, writes the CHANGELOG), commit it →
   `pnpm build` → `pnpm changeset publish` (the repo's `release` script). Be
   logged in to the npm account that owns `@megasaver`. This ships the Pro
   commands **and** the real key. Verify with an `npm pack` dry-run: install the
   tarball, confirm `mega savings history` prints the upsell and
   `mega license activate <issued-key>` succeeds.
3. **[REC · S] Back up the private key offline.** `issue.mjs` signs with
   `.private-key.pem`; lose it and every issued key becomes unreissuable.

## Phase 2 — Make the funnel convert (commerce + site)

4. **[BLOCKER · M] Buy megasaver.dev + point DNS** at your chosen static host.
5. **[BLOCKER · S] Deploy `site/`** to a static host (GitHub Pages / Netlify /
   Vercel / Cloudflare Pages), no build step. `/pro` resolves automatically
   (it's `site/pro/index.html`, a directory index). Verify `og.png` unfurls in a
   real X/Slack preview.
6. **[REC · S] Set the real domain** in the canonical/OG/Twitter tags of
   `site/index.html` + `site/pro/index.html` (skip if you keep megasaver.dev).
7. **[BLOCKER · M] Create the Gumroad product** ($7.99/mo) and swap the
   placeholder URL in **both** CTAs (`site/pro/index.html:168` and `:247`). Wire
   the post-purchase email to deliver the key (or trigger your manual issue
   step).

## Phase 3 — Operate + launch

8. **[REC · M] Per-sale fulfillment.** On each sale:
   `node scripts/license/issue.mjs <customer-id> [--exp <iso>]` → email the
   `msp_…` key → the buyer runs `mega license activate <key>`. Manual until
   Stripe.
9. **[REC · S] GitHub Release (optional).** The README advertises
   `releases/latest/download/mega.mjs`; either cut a Release with that asset or
   rely on `npm i` and trim the README line so it doesn't 404.
10. **[REC · S] Post the launch content.** Drafts are ready in
    `docs/launch/launch-content.md` (Show HN, X EN/TR, Product Hunt). Post only
    after the domain is live, the site is deployed, and `og.png` unfurls.

---

## Critical path

Decision 1 & 2 → keypair (1) → republish (2) → **[ domain (4) + deploy (5) +
Gumroad (7) in parallel ]** → fulfillment (8) → launch (10). Steps 1–2 and 4–7
are the true blockers; the rest is polish/ops.

## What is NOT needed for launch

Stripe / automated billing (Gumroad handles checkout + is merchant of record for
VAT/sales tax); a 4th Pro module; a customer portal. Revisit Stripe only once
manual issuance becomes a real bottleneck.
