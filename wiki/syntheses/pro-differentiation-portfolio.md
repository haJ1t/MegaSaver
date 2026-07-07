---
title: Pro Differentiation Portfolio — subscription moat ideas
tags: [synthesis, business, product, pro, ideas]
sources: [syntheses/gtm-plan-2026-07.md, syntheses/contextops-roadmap.md, docs/superpowers/specs/2026-07-06-pro-entitlement-design.md, docs/superpowers/specs/2026-07-06-pro-insights-design.md, docs/superpowers/specs/2026-07-06-pro-forecast-design.md, docs/launch/owner-pre-launch-checklist.md, git PRs 231-251, user sessions 2026-07-06/07]
status: active — module 4 (mega roi) LIVE on npm (1.6.1); price resolved $7.99/mo (2026-07-07)
created: 2026-07-06
updated: 2026-07-07
---

# Pro Differentiation Portfolio

User goal: world-class product, paid subscription, clear differentiation.
Ideation page; each picked item gets its own spec cycle per
[[concepts/superpowers-discipline]].

## Reality check (2026-07-07) — launch wave shipped after ideation

PRs #231–#251 landed after this page was first written; baseline changed:

- **Pro = 3 modules live**, all under the single `savings-analytics` key:
  `mega savings history` (m1, #237) / `insights` (m2, #238) / **`forecast`
  (m3, #240)** + gated `export`. The m3 slot went to budget & forecast; its
  spec **explicitly deferred ROI and anomaly alerts for that slot** (source:
  specs/2026-07-06-pro-forecast-design.md, Locked decisions + Non-goals).
  `mega roi` is not dead — it slides to module-4 top pick below.
- **Free proof surface shipped**: savings headline (#232,
  `@megasaver/stats/headline` → audit CLI + GUI), GUI share card → PNG + X
  intent (#233), `mega init` (#234), `mega gui` from npm (#231).
- **GUI packaging solved without Tauri**: `mega gui` (npm, loopback+token)
  covers the Faz-0 distribution need; a native shell is optional polish now.
- **Launch live**: megasaver.dev + /pro + Gumroad checkout live; prod Ed25519
  key baked (#243); v1.5.0 versioned (#244). **Sole blocker: npm publish** —
  npm still serves v1.4.1 (pre-Pro), so a buyer's `msp_` key rejects until
  `changeset publish` runs (source: docs/launch/owner-pre-launch-checklist.md).
- **Price RESOLVED (2026-07-07, user):** site price is canonical —
  **$7.99/mo**. GTM $10–15 band revised; drift flag closed on the GTM page.
  ROI examples below use $7.99.
- Launch-window non-goals (owner checklist): 4th Pro module, Stripe, customer
  portal — module-4 work starts post-publish.

## Thesis (unchanged)

Competitors are single-feature + free (claude-mem memory, ccusage metering,
Repo Prompt packing — source: [[syntheses/gtm-plan-2026-07]]). Defensible
position = integrated bundle + PROOF + agent-agnostic portable memory. Pitch:
**"We don't just save tokens — we prove it, explain it, and carry your
project's brain to every agent."** Anthropic-absorption answer: native
compaction (a) never optimizes the 8-connector fleet, (b) never reports $ ROI
against your subscription, (c) never exports your brain to a rival agent.

## Evolve existing features (renumbered to shipped reality)

| # | Today | Evolution | Why it sells |
|---|-------|-----------|--------------|
| E1 | m3 forecast projects savings; nothing divides by price | **`mega roi` — module-4 top pick.** Subscription-aware: "Pro $7.99; saved $87 + 14 extra sessions = 10.9×"; cache-aware math; first-month ROI<1× → coupon guarantee | Forecast says "where you're heading"; roi says "worth it vs price" — the conversion line forecast deliberately left out |
| E2 | m2 insights diagnoses | **`mega savings fix` (module 5)** — one-click remediation per WasteRow: compress bloated CLAUDE.md, tool-router block for chatty MCP servers, enable outline-first/diff-on-reread | Diagnostic → treatment; Pro feels alive |
| E3 | FORGE (invisible) | "Never pay for the same mistake twice" — retry-cost-saved feeds roi; weekly top-rule digest | Invisible infra → sales line |
| E4 | Share card SHIPPED (#233, GUI) | **`mega teardown`** — the remaining half: auto-generate "MCP server X eats 18K/turn" exposé as shareable md/image | Content engine (GTM Element 2) as product feature |
| E5 | Memory superset + entity graph | **Portable project brain** — `mega brain export/import`, signed `.megabrain` bundle | Anti lock-in; nobody has it; seeds Team tier |
| E6 | Agent-office (Phase 0) | **Budgeted multi-agent** — per-agent token cap + kill-switch ("5 agents, $2 each") | Bill-shock pain; CRITICAL risk → later |

## New Pro modules

| # | Idea | One-liner | Moat value |
|---|------|-----------|------------|
| N1 | **`mega bench`** | Paired runs (saver on/off): tokens + wall-time + outcome parity → shareable report card | Kills "does compression hurt quality?"; hardest to clone; internal regression gate |
| N2 | **Prompt-cache doctor** | Detect cache-busting (unstable prefix, reorder); "$X burned on misses, fix: …" | Niche economics expertise; no competitor |
| N3 | **Context firewall** | Ingress guard: .env/keys/PII never enter context; blocked-leak audit log | Security story; pro-user justification |
| N4 | **Model-mix advisor** | From usage.jsonl: "34% of Opus tokens were mechanical → route cheaper, save $X/mo" | Own-API-key only, ToS-clean |
| N5 | **Reverse leaderboard** | "Most tokens SAVED" board + share card + Pro badge | Viral loop (GTM Faz 2+) |
| N6 | **Team tier** | Phase-10 deferred cloud slice: hosted sync, org rules, web approval | Faz 3 B2B; architecture ready |
| N7 | **Anomaly alerts + persistent budgets** | Spike alerts; stored `budget.json` — both explicitly deferred from m3 (source: forecast spec Non-goals) | Natural m3 extensions; spec groundwork exists |

## Packaging rule (Free layer now real)

- **Free** SHOWS the number — headline + share card + `mega init` +
  `mega gui`. ✅ shipped.
- **Pro** EXPLAINS + ACTS + PROVES — history/insights/forecast ✅ shipped;
  next: roi, fix, teardown, bench, firewall, cache doctor.
- **Team** SHARES — shared brain + approval gate + org rules.

## Recommended sequence (post-launch rewrite)

0. **(owner, not code) publish `@megasaver/cli` 1.5.0 to npm** — sole
   activation blocker; every module below waits behind it.
1. **`mega roi` (module 4)** — top pick; the pro-analytics pure-fn +
   gated-command pattern is proven cheap (3 modules landed in one day).
2. `mega savings fix` (module 5) — insights → action.
3. `mega teardown` — share card done; exposé generator remains.
4. `mega bench` — trust moat; first big post-launch build.
5. Cache doctor / firewall / anomaly+budgets (N7) — Pro depth.

Dropped from the old list: "GUI packaging (Tauri)" — need met by `mega gui`
(#231); revisit a native shell only if distribution feedback demands it.

## Status

Realigned 2026-07-07 to the shipped launch wave. **Module 4 `mega roi` (E1)
SHIPPED same day**: built (full superpowers chain, 16 TDD tests, 3-lens final
review 3/3 approve), merged as #252, and **LIVE on npm in `@megasaver/cli`
1.6.1** (1.6.0 deprecated — broken bundle incident, see log 2026-07-07).
Activation verified end-to-end against the published tarball. Price resolved:
$7.99/mo canonical (GTM page updated). Sellable Pro surface = m1–m4. Next
module candidates: E2 `savings fix` → E4 teardown → N1 bench (see sequence
above).
