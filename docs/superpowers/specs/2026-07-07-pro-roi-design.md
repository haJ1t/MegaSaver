---
title: Pro module 4 — subscription ROI (mega roi)
date: 2026-07-07
status: approved
risk: MEDIUM
scope: a fourth proprietary pro-analytics module (subscription-aware monthly ROI) + a gated top-level `mega roi` command. No entitlement/crypto change; no persistence; no new storage.
base: main (929447cb)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved design 2026-07-07 — top-level command, saved+projected scope, m1–m3 dollar model, honest ROI<1 message, no coupon mechanics)
---

# Pro module 4 — subscription ROI (`mega roi`)

## Motivation

Modules 1–3 answer "what happened" (history), "where it leaks" (insights),
and "where you're heading" (forecast). None answers the one question that
converts and retains a subscriber: **"is Pro worth its price?"** `mega roi`
divides the month's measured savings by the subscription price and says it
plainly: "Pro $7.99/mo → saved $48.00 this month (est.) = 6.0×". It is the
conversion command — one word, shareable output (source:
wiki/syntheses/pro-differentiation-portfolio.md E1).

## Locked decisions (user-approved 2026-07-07)

1. **Top-level `mega roi`** — not under the `savings` group. The command IS
   the marketing moment; one word, tweetable. Gate + upsell mechanics
   identical to m1–m3.
2. **Scope = saved-so-far + end-of-month projection.** Reuses m3's
   `forecastSavings` pure fn for the month window, sums, and run-rate
   projection. Fixes the start-of-month false "not worth it" signal
   (day 3 would always show <1×). **Month period only** — the subscription
   is monthly; no `--period week`.
3. **Dollar model = same as m1–m3**: `INPUT_PRICE_PER_MTOK_USD` ($3/MTok)
   via `@megasaver/stats`, output labeled "(est.)". All modules quote the
   same number. Cache-aware pricing is a separate future feature (portfolio
   N2, cache doctor) — NOT bolted onto roi alone.
4. **ROI < 1× → honest message + pace hint** ("hasn't paid for itself yet ·
   on pace for 1.8× by month end (est.) · 19 days left"). No coupon/guarantee
   mechanics in the CLI — Gumroad discounts and refund policy are owner/site
   territory.
5. **Price source**: `PRO_PRICE_USD_PER_MONTH = 7.99` constant (site price is
   canonical per user decision 2026-07-07) + `--price <n|$n>` override flag.
   No entitlement/license format change — the key does not carry a price.

## Design

### 1. Proprietary pure function — `packages/pro-analytics/src/roi.ts`

- **`PRO_PRICE_USD_PER_MONTH = 7.99`** — exported const; the only place the
  Pro price lives in code.
- **`computeRoi(events, { now, priceUsd }): RoiReport`** with
  `now: number` (ms epoch, injected) and `priceUsd: number`.
  - Internally calls `forecastSavings(events, { now, period: "month" })`
    (existing m3 fn — UTC month window, in-period sums, run-rate projection,
    zero/NaN guards all inherited).
  - `roiSoFar = priceUsd <= 0 ? 0 : savedSoFar.dollars / priceUsd`;
    `roiProjected = priceUsd <= 0 ? 0 : projectedEnd.dollars / priceUsd`
    (the `<=0 → 0` guard mirrors `budgetPace`'s `amount<=0` rule; never
    NaN/Infinity).
  - `contextWindowsReclaimed = savedSoFar.tokens / CONTEXT_WINDOW_TOKENS`
    (const from `@megasaver/stats`; same definition and name as
    `SavingsHeadline`).
  - Returns:
    ```
    RoiReport = {
      period: "month";
      periodStart: string;   // ISO, from forecast
      periodEnd: string;     // ISO
      daysLeft: number;
      priceUsd: number;
      savedSoFar:   { bytes: number; tokens: number; dollars: number };
      projectedEnd: { tokens: number; dollars: number };
      roiSoFar: number;
      roiProjected: number;
      contextWindowsReclaimed: number;
      paidForItself: boolean;   // roiSoFar >= 1
    }
    ```
  - Empty events / `now === periodStart` → forecast returns zeros →
    roi fields 0, `paidForItself` false. No special-casing needed.
- Export `computeRoi`, `PRO_PRICE_USD_PER_MONTH`, `RoiReport` from
  `src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/roi.ts` (top-level)

`runRoi(input)` mirrors `runSavingsForecast` exactly:

1. `checkEntitlement("savings-analytics", { storeRoot, now, publicKey? })`
   **first** — the existing tier-based key; `@megasaver/entitlement`
   untouched.
2. Not entitled → print `ROI_UPSELL`, `return 0`. No `pro-analytics` import,
   no events read (enforced by spies, as in m1–m3).
   `ROI_UPSELL = "ROI reporting is a Mega Saver Pro feature. Activate a key:
   mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}."` — new
   const in `roi.ts`; reuses `PRO_ANALYTICS_URL` from `savings/shared.js`;
   the m1–m3 `PRO_ANALYTICS_UPSELL` string is not modified.
3. Entitled → lazy `await import("@megasaver/pro-analytics")`,
   `readAllEvents` (reuse `defaultSavingsEventReader` from
   `savings/shared.js`), `computeRoi(events, { now, priceUsd })`. Render:
   - no in-month events (`savedSoFar.bytes === 0`, mirroring forecast) →
     `"No savings recorded this month yet."`, `return 0`.
   - `roiSoFar >= 1` headline (example numbers are mutually consistent:
     $48.00/$7.99 → 6.0×; 16M tokens/200K → 80.0 sessions; 2× run-rate →
     12.0×):
     `Pro $7.99/mo → saved $48.00 this month (est.) = 6.0× · on pace for
     12.0× by month end (est.) · +80.0 sessions' worth of context`
   - `roiSoFar < 1` headline (0.7 × 31/12 elapsed → 1.8×, 19 days left):
     `ROI 0.7× so far — hasn't paid for itself yet · on pace for 1.8× by
     month end (est.) · 19 days left`
   - then a labeled breakdown (forecast style): `price`, `saved so far`
     ($ + tokens), `roi so far`, `projected end` ($ + ×), `sessions
     reclaimed`, `days left`.
   - saved/projected `$` via `formatDollarsSaved` (from `@megasaver/core`);
     the PRICE renders with fixed cents (`$7.99`) — an exact amount, not an
     estimate. ROI multiples display FLOORED to one decimal
     (`Math.floor(r*10)/10`) so a not-paid state (roiSoFar in [0.95, 1))
     never rounds up to a contradictory "1.0×"; days rounded as in forecast.
   - `--json`: `JSON.stringify(report)` (the `RoiReport`, nothing else).

**`--price` parsing (boundary, §8 parse-on-handoff):** optional `$` prefix,
both forms are dollars (`--price 5` ≡ `--price $5`). Not a finite number
> 0 → honest stderr error + `return 1` (the renderer divides by it). Absent
→ `PRO_PRICE_USD_PER_MONTH`.

Flags: `--price <n|$n>`, `--json`, `--store <dir>`. Register `roiCommand`
in `main.ts` (top level, alongside the other command groups).

### 3. Docs + changeset

- `README.md` Pro section: add a `mega roi` bullet.
- `.changeset/pro-roi.md`: `@megasaver/cli` minor. `pro-analytics` private →
  no changeset. `@megasaver/entitlement` unchanged.

## Security / risk (MEDIUM)

No crypto, no licensing logic, no persistence, no user-file mutation, no new
secrets. The entitlement seam is reused read-only with the existing feature
key. Events are already-validated `TokenSaverEvent`s from Core's reader; the
only boundary re-parse is the `--price` flag. Reviewers: **code-reviewer +
critic** (same bar as m3; the critic mutation-tests the gate spies).
Security-reviewer not required (no crypto/secrets/user-data surface).

## Testing (TDD)

- **roi (pure)**:
  - mid-month events, `now` halfway → `roiProjected ≈ 2 × roiSoFar`
    (run-rate inheritance); exact dollar division against
    `INPUT_PRICE_PER_MTOK_USD` math.
  - `paidForItself` boundary: saved == price → true (`>= 1`); just below →
    false.
  - `priceUsd <= 0` → roi fields 0, no NaN/Infinity.
  - empty events → all zeros, `paidForItself` false, no NaN.
  - `contextWindowsReclaimed = savedTokens / 200_000` exactly.
  - out-of-month events excluded (delegated to forecast; one guard test).
- **CLI roi**:
  - no license → `ROI_UPSELL`, exit 0; spies assert `computeRoi` +
    `readAllEvents` NOT called.
  - valid license → headline contains `×` + `(est.)`; `--price $5` changes
    the multiple; `--price 5` ≡ `--price $5`; bad `--price` (`abc`, `0`,
    `-5`) → stderr + exit 1.
  - ROI<1 fixture → "hasn't paid for itself yet" phrasing; near-break-even
    fixture (roiSoFar ≈ 0.97) displays "0.9×", never "1.0×" (floored display).
  - no in-month events → "No savings recorded this month yet.", exit 0.
  - `--json` shape == `RoiReport`.
- `pnpm verify` green. E2E smoke: test key → activate → `mega roi` prints a
  multiple; `--price $5` shifts it; no license → upsell.

## Non-goals (deferred)

Coupon/guarantee mechanics (owner/site); past-months ROI table (v2 /
history overlap); cache-aware pricing (portfolio N2); price read from the
license key; persistent budgets; site copy update (`/pro` bullet — owner
follow-up); `--period week`.

## Slices

- **A**: `pro-analytics` pure fn (`computeRoi` + `PRO_PRICE_USD_PER_MONTH`) — TDD.
- **B**: gated top-level `mega roi` command + register + README + changeset — TDD.
