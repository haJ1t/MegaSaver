---
title: Pro module 2 — waste/efficiency insights (mega savings insights)
date: 2026-07-06
status: approved
risk: MEDIUM
scope: a second proprietary pro-analytics module (waste breakdown + headline) + a gated `mega savings insights` command. No entitlement/crypto change.
base: main (3ebc27d9)
reviewers: [code-reviewer, critic]
manual-confirmation: given (user approved 2026-07-06)
---

# Pro module 2 — waste/efficiency insights

## Motivation

The Pro tier currently ships one module (historical savings analytics). One
feature is a thin justification for a $10–15/mo ask. This adds a second Pro
module on the same entitlement, reusing the same gated-command pattern, so the
Pro bundle answers a different question than module 1.

Three layers of the same event stream:

- **Free** — the *current cumulative total* you saved (headline).
- **Pro module 1 (`savings history`)** — *when* you saved it (day/week/project
  trends, export). Descriptive.
- **Pro module 2 (`savings insights`)** — *where you are still spending tokens*
  (which sources/tools dominate the bytes that still reach the model, and how
  well each compresses). **Diagnostic / actionable.**

## Locked decisions (user-approved 2026-07-06)

1. Second module concept = **waste/efficiency insights** (not cross-project
   leaderboard, not anomaly alerts).
2. **No entitlement/crypto change.** Entitlement is tier-based —
   `checkEntitlement(_feature, deps)` ignores the `feature` arg; any valid Pro
   license entitles every Pro feature. Module 2 reuses the existing
   `"savings-analytics"` feature key (same Pro tier). The security-critical
   `@megasaver/entitlement` package is untouched.
3. **Honesty:** insights report *real returned bytes* (evidence-preserving,
   consistent with the "we never blind the model / preserve evidence"
   principle). No fabricated "you could have saved X" counterfactuals.

## Design

### 1. Proprietary pure functions — `packages/pro-analytics/src/insights.ts`

`TokenSaverEvent` (from `@megasaver/stats`) carries per-event
`sourceKind`, `label`, `rawBytes`, `returnedBytes`, `bytesSaved`, `savingRatio`.

- **`computeWasteBreakdown(events, { by: "source" | "label" }): WasteRow[]`**
  - Group by `e.sourceKind` (`by:"source"`) or `e.label` (`by:"label"`).
  - Per group, aggregate:
    ```
    WasteRow = {
      key: string;             // sourceKind or label
      events: number;
      rawBytes: number;        // Σ rawBytes
      returnedBytes: number;   // Σ returnedBytes — bytes that STILL reached the model
      bytesSaved: number;      // Σ bytesSaved
      tokensReturned: number;  // tokensFromBytes(returnedBytes) — still-spent tokens
      tokensSaved: number;     // tokensFromBytes(bytesSaved)
      dollarsReturned: number; // $ still spent on this source
      dollarsSaved: number;    // $ saved on this source
      savingRatio: number;     // bytesSaved / rawBytes (aggregate; 0 when rawBytes===0)
      returnedShare: number;   // returnedBytes / Σ returnedBytes (0 when total===0)
    }
    ```
  - **Sort by `returnedBytes` desc, then `key` asc** (biggest ongoing cost
    first; the actionable target is high `returnedBytes` + low `savingRatio`).
  - Empty input → `[]`.
  - `savingRatio` is the *aggregate* ratio `bytesSaved/rawBytes`, NOT the mean of
    per-event `savingRatio` (correct byte-weighting). Guard `rawBytes===0 → 0`.

- **`computeWasteHeadline(events): WasteHeadline`**
  ```
  WasteHeadline = {
    totalRawBytes: number;
    totalReturnedBytes: number;
    totalBytesSaved: number;
    tokensReturned: number;      // tokensFromBytes(totalReturnedBytes)
    dollarsReturned: number;
    overallSavingRatio: number;  // totalBytesSaved / totalRawBytes (0 when 0)
    topKey: string | null;       // sourceKind with the largest returnedBytes (null when empty)
    topReturnedShare: number;    // topKey's returnedBytes / totalReturnedBytes (0 when empty)
  }
  ```
  - `topKey` is derived over the `by:"source"` breakdown (the coarse axis).
  - Empty input → all zeros, `topKey: null`, `topReturnedShare: 0`.

Pricing model: reuse `tokensFromBytes` + `INPUT_PRICE_PER_MTOK_USD` from
`@megasaver/stats` (the same flat per-MTok input rate module 1 uses — saved and
returned bytes both priced at the input rate). The 3-line `dollarsFromTokens`
helper is replicated locally (per §8 "3 similar lines > premature abstraction");
no cross-file extraction.

`pro-analytics` already depends one-way on `@megasaver/stats`; no new dependency,
no cycle. Exported from `packages/pro-analytics/src/index.ts`.

### 2. Gated CLI — `apps/cli/src/commands/savings/insights.ts`

`runSavingsInsights(input)` mirrors `runSavingsHistory` exactly:

1. `checkEntitlement("savings-analytics", { storeRoot, now, publicKey? })` **first**.
2. **Not entitled** → `input.stdout(PRO_ANALYTICS_UPSELL)`, `return 0`. Nothing
   imported from `pro-analytics`, no events read — the Pro compute never
   half-runs for a free user (the existing invariant; a test asserts it).
3. **Entitled** → lazy `await import("@megasaver/pro-analytics")`, read events via
   `defaultSavingsEventReader` (reuse), compute the headline + the
   `--by source|label` breakdown, render:
   - default: the headline line(s) + a table of the breakdown.
   - `--json`: `JSON.stringify({ headline, rows })`.
   - `--csv`: `exportSavings(rows, "csv")` (reuse; raw numbers, matching
     module 1's CSV behavior).
   - `--out <file>`: write the rendered payload; print `Wrote savings insights
     to <file>`.
   - No rows → `input.stdout("No savings recorded yet.")`, `return 0`.
   - `$` columns in the table are floored via `formatDollarsSaved` (import from
     `@megasaver/core`, exactly as `history.ts` does) so the table agrees with
     `mega audit report` / the GUI strip.

Flags: `--by source|label` (default `source`), `--json`, `--csv`, `--out <file>`,
`--store <dir>`. Matches `history.ts` reality (no `--window`, which siblings
don't implement).

Register `insights` under the existing `savings` command group
(`apps/cli/src/commands/savings/index.ts`, alongside `history` + `export`).

### 3. Docs + changeset

- `README.md` Pro section: add a `mega savings insights` bullet with a one-line
  description; keep the existing honesty disclosure.
- `.changeset/pro-insights.md`: `@megasaver/cli` minor (new command). `pro-analytics`
  is `private:true` → no changeset. `@megasaver/entitlement` unchanged.

## Security / risk (MEDIUM)

- No crypto, no licensing logic, no user-file mutation at scale, no new secrets.
  The entitlement seam is reused read-only via its public API.
- The only "trust boundary" is the same one module 1 crosses: events are read
  through Core's validated reader; insights consume already-validated
  `TokenSaverEvent`s. No re-parse needed on the read side (§8 parse-on-handoff).
- Reviewers: **code-reviewer + critic** (Pro-gated path; the "trivial-fixture
  masks reality" pattern has repeatedly bitten this codebase — the critic runs
  real experiments in an isolated worktree). Security-reviewer is **not**
  required (no crypto/secrets/user-data surface touched).

## Testing (TDD)

- **pro-analytics/insights**:
  - breakdown by source: 3 sources with distinct raw/returned/saved → correct
    aggregates, correct `savingRatio` (aggregate not mean), correct
    `returnedShare` summing to 1, sorted by `returnedBytes` desc, tie broken by
    `key` asc.
  - breakdown by label: groups by `label` instead of `sourceKind`.
  - a group with `rawBytes===0` → `savingRatio===0` (no NaN/Infinity).
  - empty events → `[]`.
  - headline: totals + `overallSavingRatio` + `topKey`/`topReturnedShare` over
    the source axis; empty → zeros + `topKey:null`.
- **CLI insights**:
  - no license → prints `PRO_ANALYTICS_UPSELL`, computes nothing, exit 0
    (assert `pro-analytics` compute is NOT invoked on the upsell path).
  - valid test license (inject publicKey + store) → prints the headline + table;
    `--json` shape `{ headline, rows }`; `--csv` via `exportSavings`; `--out`
    writes the file + prints the confirmation.
  - no events → `No savings recorded yet.`, exit 0.
- `pnpm verify` green. E2E smoke: issue a test key → `mega license activate` →
  `mega savings insights` shows the breakdown; no license → upsell.

## Non-goals (deferred)

Anomaly/spike alerting; cross-project leaderboard; per-event drill-down beyond
`--by label`; Stripe/billing; a third module.

## Slices

- **A**: `pro-analytics` pure fns (`computeWasteBreakdown` + `computeWasteHeadline`) — TDD.
- **B**: gated `mega savings insights` command + register + README + changeset — TDD.
