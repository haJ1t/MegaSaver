# Design Spec: Field Telemetry Wire — Measured Tokens, Estimated Dollars (Child-Spec #3)

> **Date:** 2026-08-01
> **Packages:** `@megasaver/stats` (schema + reporting), `@megasaver/context-gate` (write site), `apps/cli` (audit surface)
> **Risk Level:** **MEDIUM** — additive schema fields and reporting surfaces; no saver-core mutation, no user-file writes. Reviewer: `code-reviewer`.
> **Spec Status:** DRAFT — awaiting user approval.
> **Umbrella:** Quantum Context Engine v3 §21.2; closes Phase 0's second exit condition alongside child-spec #2.
> **User directive (2026-08-01):** *"Let us see how many tokens we save. We do not need to see actual money saved — an estimate from the published list prices of the models used is enough."* Tokens are the headline; dollars are a labelled estimate.

---

## 1. Starting position (corrected)

An earlier note in this lane said field telemetry does not flow at all because
`stampWorkspaceTelemetry` has zero consumers. That is true of **that function**,
but it overstates the gap. The real position, verified against the code:

| Capability | Today |
|---|---|
| Events carry `workspaceKey` + `liveSessionId` | **Already there** — `overlayTokenSaverEventSchema`; `record-output.ts:383` writes them |
| Signed savings (`deltaBytes`), expansion rows (`kind: "expansion"`) | **Already there** — Track B |
| Recovery rate `R` from the real ledger | **Already there** — `recoveryRate()`, measured 2.4% |
| `stampWorkspaceTelemetry` / `isStoreFresh` | Written, **exported only, no consumer** |
| **Token counts** | **bytes/4 everywhere** — `tokensFromBytes = ceil(bytes/4)`, used by `honest-metrics` and `savings-headline` |
| **Model identity** | **Not available at the saver hook** — no `model` field in `saver.ts` / `saver-run.ts` |
| Dollar figure | One flat Sonnet-class constant, `INPUT_PRICE_PER_MTOK_USD = 3.0`, already labelled `isEstimate` |

So the gap is not "no telemetry". It is that **the number the user wants to see —
tokens saved — is an estimate derived from a byte count**, and the measured
divergence of that estimate is already on record (Track B B4: code 0.975, prose
1.013, **json 1.193**, turkish 0.961 — bytes/4 understates JSON by ~19%).

This spec makes the token number measured, gives the store-freshness and model
provenance needed to price it, and reports it token-first.

---

## 2. Goal & Non-Goals

**Goal.** A real session produces events carrying **measured** token counts, and
`mega audit` reports:

1. **Headline: net tokens saved** (gross compression credits minus expansion
   debits — the existing signed model, now in real tokens).
2. **Secondary: an estimated dollar figure**, computed as saved tokens × the
   published list input price of the model that produced the turn, explicitly
   labelled an estimate and an upper bound.

**Non-goals.**

- **Actual billing reconciliation.** Per the user directive, no attempt is made
  to match a real invoice. The proxy usage ledger stays the only place real
  billed usage exists.
- **Cache-class accounting in the dollar estimate.** A saved token that *would*
  have been a cache-read costs ~0.1× an input token. Pricing every saved token
  at the input rate is therefore an **upper bound**. Stated once, prominently
  (§5.3); not modelled.
- Changing what the saver compresses, its floors, or its modes.
- Publishing a savings claim. Child-spec #2 §7's claim boundary still binds:
  these numbers are operator-facing diagnostics, not marketing figures.
- Retro-filling historical rows. Pre-existing JSONL rows keep their bytes/4
  reading and are labelled as such (§4.3).

---

## 3. Design

### 3.1 Measured tokens on the event (additive)

`overlayTokenSaverEventSchema` and `tokenSaverEventSchema` gain three optional
fields:

```typescript
// Measured with the real tokenizer at the write boundary, never bytes/4.
// Optional so every pre-existing row keeps parsing (Track B precedent).
rawTokens: z.number().int().nonnegative().optional(),
returnedTokens: z.number().int().nonnegative().optional(),
// Signed, never clamped — negative means the rewrite inflated the payload,
// exactly as deltaBytes does. Expansion rows carry a negative value.
deltaTokens: z.number().int().optional(),
```

Computed in `record-output.ts` at the same point it already computes
`deltaBytes`, using `countTokens` from `@megasaver/output-filter` (cl100k,
lazily loaded — the existing real tokenizer). Counted over **model-facing text**
(summary + excerpts + gap markers + footer + envelope), the same quantity
`deltaBytes` is computed over, so bytes and tokens describe the same object.

**Failure posture.** `countTokens` is async and lazy-loads its encoder. If it
throws or exceeds a 50 ms budget, the fields are **omitted** — never
back-filled with bytes/4, because a silently-estimated value in a field named
`rawTokens` is the defect class this spec exists to remove. A row without token
fields is read as "unmeasured" (§4.3), not as zero.

### 3.2 Store-freshness and model provenance

Two more optional fields, and the consumer `stampWorkspaceTelemetry` never had:

```typescript
isFreshStore: z.boolean().optional(),   // via isStoreFresh (child-spec #1)
modelId: z.string().min(1).optional(),  // null-safe: absent means unknown
```

`record-output.ts` adopts `stampWorkspaceTelemetry` at its write boundary so
`workspaceKey` / `liveSessionId` validation is centralised and `isFreshStore` is
recorded. This gives child-spec #1's function its consumer.

**Model identity — resolution order, fail-honest:**

1. The proxy usage ledger (`proxy-usage/usage.jsonl`) for the same workspace and
   a request timestamp within the event's window, when the proxy is running.
2. The workspace's configured default model, if the operator set one
   (`.megasaver/telemetry.json` `{"defaultModelId": "..."}`).
3. **Absent.** The field is omitted. It is never guessed from a rate card.

The saver hook does not see the model, and this spec does not invent a path for
it to. Most rows will carry no `modelId`, and §3.3 prices those explicitly as
"unknown-model" rather than silently assuming the default.

### 3.3 Published price table (pinned, dated, auditable)

New `scripts/model-list-prices.json`, in the same spirit as the pinned
`scripts/benchmark-rates.json`:

```json
{
  "capturedAt": "2026-08-01",
  "source": "public pricing pages, USD per million input tokens",
  "unknownModelId": "claude-sonnet-5",
  "prices": {
    "claude-opus-5":    { "inputPerMTokUsd": 15.0 },
    "claude-sonnet-5":  { "inputPerMTokUsd": 3.0 },
    "claude-haiku-4-5": { "inputPerMTokUsd": 0.8 }
  }
}
```

Rules:

- `capturedAt` is mandatory and rendered with the estimate. A price table with
  no date is an undated claim.
- `unknownModelId` names which entry prices rows with no `modelId`. The report
  shows the share of tokens priced that way (§5.2) — a run that is 90%
  unknown-model must look like one.
- A model id absent from the table prices at `unknownModelId` and is counted in
  the unknown share, never dropped.
- The exact numeric values above are **placeholders to be replaced with the
  operator's own reading of the published pages at implementation time**; the
  test asserts table *shape and date presence*, never a specific price, so the
  suite does not go stale when a vendor changes a number.

### 3.4 The estimate

```
estimatedUsd = Σ over rows [ deltaTokens(row) × priceFor(row.modelId) ] / 1_000_000
```

Signed throughout: an expansion row's negative `deltaTokens` subtracts, so a
window where recovery cost more than compression saved shows a **negative**
estimate. It is displayed, not clamped (I5).

---

## 4. Reporting surface

### 4.1 `mega audit` headline

```
Tokens saved (net, measured):  1,284,300
  gross compression credits:   1,402,110
  expansion debits:             −117,810
Estimated value:               ~$8.42  (est.)
  priced at published list input rates, captured 2026-08-01
  upper bound — ignores prompt-cache discounts on tokens that
  would have been re-read rather than re-sent
  model mix: opus-5 62% · sonnet-5 11% · unknown 27%
```

Tokens are the headline; the dollar line is subordinate, prefixed `~`, suffixed
`(est.)`, and never appears without its two caveat lines.

### 4.2 Coverage line (mandatory)

```
measured coverage: 84% of rows (16% pre-measurement, read as bytes/4)
```

Printed whenever coverage < 100%. Without it, a mostly-unmeasured window looks
identical to a fully measured one.

### 4.3 Mixed-provenance rule

Aggregates prefer `deltaTokens` when present and fall back to
`tokensFromBytes(deltaBytes)` otherwise — the same read rule `deltaBytesOf`
already establishes for the signed byte field. The two are **never summed
without reporting the split** (§4.2). `tokensFromBytes` is retained for exactly
this fallback and is not used for any new writer.

---

## 5. Invariants

- **I5 (signed accounting)** holds for tokens as it does for bytes: negative
  totals are displayed, never clamped.
- **No estimate wearing a measurement's name.** A field called `rawTokens` is
  either measured or absent.
- **The dollar figure is never the headline** and never appears without
  `(est.)`, the capture date, and the upper-bound caveat.
- **Unknown-model share is always visible** when non-zero.
- **Zero-consumer rule:** this spec does not land until a real session on a real
  machine produces at least one event carrying measured tokens (§7 item 5). The
  E12 finding — every savings number in the wiki came from the harness, never a
  real session — is what this exists to close.

---

## 6. Test Plan (TDD — red first)

**Schema (`packages/stats/test/event.test.ts`):** a pre-existing row without the
new fields still parses; a row with `deltaTokens: -400` parses and is read as
negative; `rawTokens: -1` is rejected.

**Write site (`packages/context-gate/test/record-output.test.ts`):** an event
written for a known fixture carries `rawTokens`/`returnedTokens` matching
`countTokens` on the same text; a `countTokens` that throws produces a row with
the fields **omitted** and the rest intact; `isFreshStore` is present.

**Model resolution (`packages/stats/test/model-provenance.test.ts`):** proxy row
in the window wins; configured default is used when no proxy row; **neither ⇒
field omitted, never defaulted**.

**Pricing (`packages/stats/test/estimated-value.test.ts`):** signed sum across
mixed models; a negative-`deltaTokens` window yields a negative estimate; a
model id absent from the table prices at `unknownModelId` **and** raises the
unknown share; the table's `capturedAt` is required (a table without it is
rejected). No test asserts a specific price.

**Reporting (`apps/cli/test/commands/audit-*.test.ts`):** tokens render above
dollars; the dollar line never renders without `(est.)` + date + caveat; the
coverage line appears when coverage < 100% and is suppressed at 100%; the
unknown-model share appears when non-zero.

**Mutations to verify:** clamp the signed token total (must fail); price
unknown-model rows silently at the default without counting them (must fail);
back-fill `rawTokens` from bytes/4 on tokenizer failure (must fail); drop the
capture date (must fail).

---

## 7. Definition of Done

1. Spec approved; `code-reviewer` pass in a separate context (MEDIUM).
2. Plan in `docs/superpowers/plans/`.
3. TDD red→green for §6, including the four mutations.
4. `pnpm verify` green.
5. **Field evidence:** a real session on a real machine (saver hook installed)
   produces ≥1 event with measured `rawTokens`/`returnedTokens`, and
   `mega audit` renders the token headline plus a labelled estimate. Captured
   terminal output archived. **This item is the point of the spec — it is not
   satisfied by tests.**
6. `wiki/log.md` entry; `syntheses/saver-root-cause-2026-07-28` §E updated (its
   "no field telemetry exists" finding gets its closing evidence, or an honest
   note that the saver still is not installed here).
7. Changeset for the `@megasaver/stats` public surface.
8. No savings claim published (child-spec #2 §7).

---

## 8. Open Questions

- **Tokenizer vs vendor tokenizer.** `countTokens` is cl100k; Anthropic models
  tokenize differently. The measured divergence on our own corpora (0.96–1.19)
  is the honest error bar, and the report should say "measured with cl100k"
  rather than implying vendor parity. Is a per-model tokenizer worth it later,
  or does the estimate's upper-bound framing already absorb it?
- **50 ms token-count budget** is a guess. Measure `countTokens` p95 on real
  payload sizes during implementation and pin the real number.
- **Where does the operator set `defaultModelId`?** `.megasaver/telemetry.json`
  is proposed; if a config file already covers workspace-level settings, fold it
  there instead of adding a file.
