# Saver Metrics Honesty — Wave 5 Design

- **Date:** 2026-07-11
- **Risk:** HIGH (token audit logic, savings accounting — §12)
- **Scope:** Wave 5 (final) of the saver-savings-gaps program
  ([wiki/syntheses/saver-savings-gaps.md](../../../wiki/syntheses/saver-savings-gaps.md)):
  findings F30–F34, plus one wave-4 conscious-accept absorbed (overlay event
  schema enrichment for `secretsRedacted`/`chunksStored`).
- **Base:** `main` @ 05b26313 (waves 1–4 + E5 brain merged). Branch
  `feat/saver-metrics-honesty`.
- **Status:** approved (design gate 2026-07-11, user picked all four
  recommended options)

## Problem

Theme F of the 46-finding audit: **reported savings ≠ delivered bytes.**

- F30 — the persisted `returnedBytes`/`bytesSaved`/`savingRatio` are computed
  by `filterOutput` (output-filter types.ts:346-352) from summary + excerpt
  bodies only. The actually-delivered replacement text also carries the D16
  elision markers (~25–35 B each, ≤ excerpts+1, added later by
  `returnedTextOf`, record-output.ts:44-59) and the recovery footer
  (`[Mega Saver: compressed …]`, ~120–180 B, appended even later in
  saver.ts:363-366, *after* `recordCompression`/`appendOverlayEvent`
  persisted the smaller numbers). Every downstream — honest-metrics,
  savings-headline ($), `hooks status`, GUI stats/events, the alerts `ratio`
  axis — inherits the optimism. Bonus defect: the footer's token % uses
  `ceil(totalBytes/4)` while the filter's `returnedTokens` sums per-excerpt
  estimates — two divergent formulas.
- F31 — a settings rewrite that removes `ANTHROPIC_BASE_URL` makes the proxy
  supervisor's `monitorTick` block + drain and never re-apply the route
  (supervisor.ts:267-269): metering dies silently and forever.
- F32 — one torn line in the proxy `usage.jsonl` zeroes every future
  `mega audit usage` report (proxy store.ts:50). The overlay events reader is
  corruption-tolerant; the proxy usage reader is not — an asymmetry.
- F33 — `audit usage` divides per-cwd savings by **global** proxy usage
  (usage.ts:129-132): with 2+ workspaces the ratio is wrong by construction.
- F34 — the HTTP proxy is passthrough + metering only
  (proxy-handler.ts:200); it saves zero tokens, yet surfaces present its
  stream as `proxy_mediated_token_savings`, and
  `session saver stats` hardcodes `mediation: "proxy"` onto saver-hook
  events.
- Wave-4 accept — overlay events do not carry `secretsRedacted`/
  `chunksStored` (event.ts schemas), so summary rebuilds can only preserve
  those counters via `carryForward` and lose them when the prior summary is
  unreadable.

## Design

Principle: **every reported number counts the bytes actually delivered to
the model, and no ratio divides mismatched scopes.**

### F30 — honest delivered-bytes accounting + net-negative guard

`recordAndFilterOverlayOutput` becomes the single place the persisted
numbers are computed, from the FINAL delivered text:

- `RecordOverlayOutputInput` gains an optional
  `footerTemplate?: (r: { rawBytes: number; returnedBytes: number; chunkSetId?: string }) => string`.
  The hook passes its footer builder; the daemon path passes the same one
  (both routes through this function).
- Flow inside record: build `returnedText = returnedTextOf(filtered)`
  (summary + source-ordered excerpts + D16 markers), generate the footer
  once from the marker-inclusive size, append it, and set
  `returnedBytes = byteLength(finalText)` — summary + markers + excerpts +
  footer, everything the model receives. The footer's displayed numbers are
  the persisted ones; a 1–2 byte digit-width drift from the single-pass
  computation is tolerated and documented (no fixed-point iteration).
- `bytesSaved = max(0, rawBytes − returnedBytes)`;
  `savingRatio = rawBytes === 0 ? 0 : bytesSaved / rawBytes`.
- **Net-negative guard:** computed BEFORE any side effect
  (`saveOverlayChunkSet`, `appendOverlayEvent`, evidence). If the final
  delivered size ≥ `rawBytes`, the decision degrades to `passthrough`: no
  chunk set, no event, the original output reaches the model untouched. The
  model never receives a replacement larger than the original. (This also
  structurally preserves the honest-metrics invariant
  `returnedTokens ≤ rawTokens`, honest-metrics.ts:20.)
- Callers no longer append their own footer: saver.ts's footer block moves
  into the template it passes; `returnedText` comes back ready-to-emit.
  Library callers of `filterOutput` that never render markers/footers keep
  the filter-level numbers — the change is scoped to the record/persist
  layer, not the filter.
- Token unification at the reporting layer: every persisted/reported token
  figure derives from `tokensFromBytes` (ceil(bytes/4)) applied to the
  persisted byte totals. The filter's internal per-excerpt `returnedTokens`
  stays as-is (library semantics, threshold decisions) but is no longer
  quoted on user surfaces.

### F31 — route drift self-heal

Proxy supervisor `monitorTick`: when the route is drifted (the expected
`ANTHROPIC_BASE_URL` absent/changed in settings) while the supervisor is
active, re-apply the route (same settings write the enable path uses), bump
a persisted `routeReapplies` counter (supervisor state), and log. Deliberate
disable stops the supervisor first, so re-apply cannot fight the user.
Doctor gains a proxy-route check: WARN when `routeReapplies > 0` (something
keeps rewriting settings — churn signal), FAIL when a re-apply attempt
itself fails (route cannot be restored). Exact file wiring resolved at plan
time from supervisor.ts.

### F32 — corruption-tolerant usage reader

The proxy usage reader (proxy store.ts:50 area) gains `readOverlayEvents`
parity: per-line parse in try/catch, schema-validated, torn/invalid lines
skipped and **counted**. `mega audit usage` prints the skipped-line count
when non-zero ("N unreadable usage lines skipped") — loss becomes visible
instead of zeroing the report.

### F33 — scope-matched ratios

- Usage rows gain an optional `workspaceKey` (strict schema + optional field
  → old rows keep parsing). The writer stamps it when a workspace signal
  exists for the request; the mechanism (env, header, launch scope) is
  resolved at plan time from the proxy handler.
- `audit usage` computes ratios ONLY over scope-matched pairs: per-workspace
  savings ÷ that workspace's usage rows. Rows without a key aggregate into
  an explicitly labeled global bucket; if the only available comparison is
  cross-scope, the ratio is omitted and the report says so
  ("global usage — scope mismatch, ratio omitted").
- Invariant: **no ratio whose numerator and denominator have different
  scopes.**

### F34 — the proxy is metering, not a saver

- Surfaces stop presenting the proxy stream as savings:
  `proxy_mediated_token_savings` is reframed to metered-token wording (the
  proxy's structural savings are 0 — passthrough by design,
  proxy-handler.ts:200); interception-rate framing stays (it is real).
- `session saver stats` stops hardcoding `mediation: "proxy"` for saver-hook
  events — they are `saver_hook`.
- Honest-metrics classification: proxy-stream observations can never
  classify as `eligible` savings; they are metering observations. (Native
  and passthrough handling unchanged.)

### W5-extra — event schema enrichment (closes the wave-4 accept)

- `overlayTokenSaverEventSchema` gains optional
  `secretsRedacted?: number` and `chunksStored?: number` (stays `.strict()`;
  old JSONL lines keep parsing).
- `appendOverlayEvent` writes them onto the event row (it already receives
  both as side args).
- `rebuildOverlaySummaryFromEvents` folds them from events when present;
  `carryForward` remains the fallback for pre-wave-5 rows. A genuinely
  unreadable summary with post-wave-5 events now loses nothing.
- Reconcile's line-count trigger tightens from "all non-empty lines" to
  "schema-valid lines" (kills the documented garbage-line re-rebuild-every-
  sweep ponytail; the comment is removed with the fix).

## Test strategy (RED-first, per finding)

| Finding | Failing test before code |
|---|---|
| F30 | `recordAndFilterOverlayOutput` with a footerTemplate → persisted `returnedBytes` === `byteLength(returnedText)` (markers + footer included); event row and evidence carry the same number. Guard: a raw input whose compressed form + footer ≥ raw → decision `passthrough`, zero side effects (no chunk set file, no event line). Footer numbers == persisted numbers (±digit drift documented). |
| F31 | monitorTick with a settings file whose base URL was removed while supervisor active → settings rewritten back + `routeReapplies` incremented; doctor check WARNs on counter>0, FAILs on a re-apply that throws. |
| F32 | usage.jsonl with one torn line between two valid rows → reader returns both valid rows + skipped=1; `audit usage` renders the skip note (today: report zeroes). |
| F33 | usage rows with two workspace keys + savings in one workspace → ratio uses only the matching rows; keyless rows → labeled global bucket, no cross-scope ratio. |
| F34 | `session saver stats` observation mediation === `saver_hook` (today: `proxy`); proxy-stream surface renders metered wording, no savings framing; honest-metrics: proxy observation never `eligible`. |
| extra | Event row written with `secretsRedacted`/`chunksStored`; rebuild from post-wave-5 events recovers both counters WITHOUT carryForward; old-format event lines still parse; reconcile ignores garbage lines in its drift count. |

Re-baselines expected: `record-output.test.ts` (returnedBytes now
marker+footer-inclusive), saver e2e fixtures (footer produced by record),
`filter-output.test.ts` untouched (filter semantics unchanged),
`overlay-selfheal`/`overlay-lock` (event-carried counters), stats/GUI
fixtures reading returnedBytes.

## Non-goals

- No new metrics subsystem; existing stores/surfaces only.
- No tokenizer-accurate token counting — `bytes/4` stays, with its "never
  bill a model off this number" caveat.
- No alerts threshold recalibration (the ratio axis is baseline-relative;
  the F30 correction shifts all days consistently).
- No compression in the HTTP proxy (F34 clarifies the opposite).
- No backfill of `workspaceKey`/counter fields onto historical rows.

## Package impact / build order

`stats` (event schema, honest-metrics classification, reconcile tightening)
→ `context-gate` (F30 record accounting + guard) → `cli` (saver footer
template, audit usage F32/F33, doctor route check F31, status/stats copy
F34) → proxy/supervisor modules (F31/F32/F33 — exact files resolved at plan
time; recon pointers: supervisor.ts:267-269, proxy store.ts:50,
usage.ts:129-132, proxy-handler.ts:200). `output-filter` expected untouched.
Changeset: minor `stats`, `context-gate`, `cli`; patch/minor for the proxy
package(s) as the plan discovers them.

## Review sign-offs

- Design gate: user approved (2026-07-11), all four AskUserQuestion
  decisions = recommended options (F30 accounting+guard, F31 auto-re-apply,
  F33 scoped-usage+labeled-fallback, event-schema enrichment included).
- Spec review: pending user review.
- Final: code-reviewer + adversarial critic in fresh contexts (HIGH risk,
  §12).
