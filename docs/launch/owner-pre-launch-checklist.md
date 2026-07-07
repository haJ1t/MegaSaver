# Mega Saver — Owner Pre-Launch Checklist

The Pro tier is built, reviewed, and merged: entitlement seam + three analytics
modules (`savings history` / `insights` / `forecast`) + the `/pro` pricing page.
Everything below is what **only you** can do — it needs your accounts, money,
keys, and business decisions. None of it is a code task an agent can finish for
you.

> Verified against the repo + npm on 2026-07-06. Re-check the "where things
> stand" facts before you act — they drift as you publish.

---

## Where things actually stand (verified 2026-07-07)

Done:
- **✅ Site is live.** `https://megasaver.dev/` and `/pro` serve (200, valid SSL,
  apex-primary, clean URLs) from Vercel. Bought via GoDaddy; A record → Vercel.
- **✅ Checkout is live.** The "Get Mega Saver Pro" CTAs point at the real Gumroad
  membership `https://megasaver.gumroad.com/l/pro` ($7.99/mo).
- **✅ Real license key is in the repo.** The placeholder Ed25519 public key was
  replaced with the vendor's real one (`#243`); the private key is held offline.

The ONE remaining blocker:
- **✅ RESOLVED (2026-07-07): `@megasaver/cli` 1.5.0 is live on npm** —
  published 08:19Z, dist-tag `latest`, access public, npm `license` field
  `SEE LICENSE IN NOTICE`. End-to-end activation verified against the
  PUBLISHED tarball the same day: free upsell → `mega license activate` with
  a prod-key-signed short-expiry test license → "Pro activated" → gated
  `mega savings history` runs. Buyers' `msp_` keys now work.
  (`mega roi` shipped later the same day in **1.6.1** — note 1.6.0 is
  npm-deprecated: its tarball inlined a stale pro-analytics build and the
  entitled `mega roi` path crashed; fixed by the prepack dependency-closure
  build, e2e-verified on the published 1.6.1.)

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

`megasaver.dev` is hardcoded in the shipped CLI's upsell.

**✅ DECIDED (2026-07-06): buy megasaver.dev via Vercel** (Vercel is registrar +
host + DNS + SSL in one). Keeping the name that's already published simplifies
everything: the canonical/OG tags already say `megasaver.dev` (no meta change),
and the shipped CLI already points there (no republish needed for the domain).
See Phase 2 for the Vercel specifics.

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

4. **[BLOCKER · M] Buy megasaver.dev in Vercel + assign it.** Vercel → Domains →
   register `megasaver.dev`, then add it to the site project. Vercel provisions
   DNS + SSL automatically (it's the registrar), so there are no manual records.
5. **[BLOCKER · S] Deploy `site/` on Vercel.** Import the repo, then — this is the
   one setting that matters — set **Root Directory = `site`** (the repo is a
   pnpm/turbo monorepo; without this Vercel tries to build the whole workspace and
   fails). `site/` has no `package.json`, so Vercel serves it as static: Framework
   = Other, no build/install. `/pro` resolves (it's `site/pro/index.html`), and
   `site/vercel.json` pins `cleanUrls` + `trailingSlash:false` so the canonical
   `/pro` (no slash, no `.html`) is deterministic. Verify `og.png` unfurls in a
   real X/Slack preview.
6. **[✅ N/A] Domain in meta tags** — no-op. The canonical/OG/Twitter tags on both
   pages already point at `megasaver.dev` (Decision 2), so nothing to change.
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
