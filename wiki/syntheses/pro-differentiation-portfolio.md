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

## LOCKED 1.x → 2.0 program (user-approved 2026-07-07)

Items 0–2 of the earlier sequence are DONE (1.5.0 published; roi shipped in
1.6.1; savings fix shipped in 1.7.0). The road to 2.0, each with its own
full superpowers chain:

| Release | Item | One-liner |
|---|---|---|
| 1.8 | **E4 `mega teardown`** | auto-generated waste exposé (md/image) — content engine as product |
| 1.9 | **N1 `mega bench`** | paired saver on/off runs → token+time+outcome parity report |
| 1.10 | **prose-compressor** | ships the engine; upgrades savings-fix R5 from advice to real `[apply]` |
| 1.11 | **N2 cache doctor** | cache-miss detection + $ burned + fixes |
| 1.12 | **N3 context firewall** | .env/keys/PII ingress guard + blocked-leak log |
| 1.13 | **N7 anomaly alerts + persistent budgets** | m3 forecast's deferred extensions |
| **2.0** | **E5 portable project brain** | signed `.megabrain` export/import — anti lock-in flagship |

Deliberately EXCLUDED from 1.x: N5 leaderboard (needs backend; GTM Faz 2+),
N6 Team tier (Faz 3; natural post-2.0 arc), E6 budgeted multi-agent
(CRITICAL; needs agent-office Phases 1–2), i18n `tr` (v2.x).
Dropped earlier: "GUI packaging (Tauri)" — need met by `mega gui` (#231).

## Status

Realigned 2026-07-07 to the shipped launch wave; same day: **module 4
`mega roi` SHIPPED** (#252, live in 1.6.1; 1.6.0 deprecated — bundle
incident, see log) and **module 5 `mega savings fix` SHIPPED** (#253, HIGH
chain, 4 confirmed review catches fixed RED-first, in 1.7.0). Price
resolved: $7.99/mo canonical. Sellable Pro surface = m1–m5. The 1.x → 2.0
program above is LOCKED (user, 2026-07-07); next up: 1.8 `mega teardown`.

Update 2026-07-09: the LOCKED program has run to its 1.x end. **1.12 N3
context firewall SHIPPED** (module 10, live 1.12.0) and **1.13 N7 anomaly
alerts + persistent budgets SHIPPED** (module 11: `mega alerts` +
`mega savings budget`, `mega savings forecast` auto-load). Next and final:
**2.0 E5 portable project brain** — the signed `.megabrain` export/import
anti-lock-in flagship.
