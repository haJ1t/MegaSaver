# Field Telemetry Wire Implementation Plan (Child-Spec #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "tokens saved" a measured number instead of a byte-count estimate, record the provenance needed to price it, and report it token-first with a clearly-labelled dollar estimate derived from published list prices.

**Architecture:** Six additive changes, no behaviour change to what the saver compresses. Three optional token fields join the existing signed-bytes event; a pinned dated price table plus a pure valuation function turn those tokens into a labelled estimate; the overlay write site measures with the real cl100k tokenizer already in the repo; the audit renderer puts tokens above dollars. Every new field is optional so pre-existing JSONL rows keep parsing, and every aggregate reports the share it could not measure.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Biome. Reused seams: `countTokens` (`@megasaver/output-filter`, async cl100k, lazy), `appendOverlayEvent` / `deltaBytesOf` / `tokensFromBytes` / `isStoreFresh` / `stampWorkspaceTelemetry` (`@megasaver/stats`), `recordAndFilterOverlayOutput` (`@megasaver/context-gate`), `auditSavingsHeadline` (`apps/cli/src/commands/audit/shared.ts`).

## Global Constraints

- **A field named `rawTokens` is measured or absent.** On tokenizer failure or budget overrun the token fields are OMITTED — never back-filled from `bytes/4`.
- **Signed, never clamped.** `deltaTokens` may be negative; totals may be negative; negatives are displayed.
- **Tokens are the headline.** The dollar line is subordinate, prefixed `~`, suffixed `(est.)`, and never rendered without its capture date and its upper-bound caveat.
- **Price tests assert shape and date presence, never a specific price.** A vendor changing a number must not turn the suite red.
- **Unknown-model rows are priced at the declared fallback AND counted in a visible unknown share.** Never silently defaulted.
- **Coverage line is mandatory when measured coverage < 100%.**
- Every new schema field is `.optional()`; pre-existing rows must keep parsing.
- No savings claim is published from these numbers (child-spec #2 §7 still binds).
- TS strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM `.js` specifiers.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/stats/src/event.ts` (modify) | Three optional token fields on both event schemas + `deltaTokensOf` read rule |
| `scripts/model-list-prices.json` (create) | Pinned, dated published list prices |
| `packages/stats/src/model-prices.ts` (create) | Load + validate the table; resolve a price for a model id |
| `packages/stats/src/estimated-value.ts` (create) | Signed valuation, coverage share, unknown-model share |
| `packages/stats/src/model-provenance.ts` (create) | Pure model-id resolution: proxy row → configured default → absent |
| `packages/context-gate/src/record-output.ts` (modify:312-400) | Measure tokens over `input.raw` / `finalText`; stamp freshness + model |
| `apps/cli/src/commands/audit/shared.ts` (modify:71-88) | Token-first render |
| `packages/stats/src/index.ts` (modify) | Export the new surface |

---

## Task 1: Token fields on the event schema

**Files:**
- Modify: `packages/stats/src/event.ts`
- Test: `packages/stats/test/event.test.ts`

**Interfaces:**
- Produces: optional `rawTokens` / `returnedTokens` / `deltaTokens` on `tokenSaverEventSchema` and `overlayTokenSaverEventSchema`; `deltaTokensOf(event): number | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `packages/stats/test/event.test.ts`:

```typescript
import { deltaTokensOf, overlayTokenSaverEventSchema } from "../src/event.js";

describe("measured token fields", () => {
  const base = {
    id: "ove-1",
    liveSessionId: "sess-1",
    workspaceKey: "wsk-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceKind: "file" as const,
    label: "read",
    rawBytes: 4000,
    returnedBytes: 1000,
    bytesSaved: 3000,
    deltaBytes: 3000,
    savingRatio: 0.75,
    summary: "s",
  };

  it("parses a pre-measurement row that carries no token fields", () => {
    const parsed = overlayTokenSaverEventSchema.parse(base);
    expect(deltaTokensOf(parsed)).toBeUndefined();
  });

  it("keeps a negative deltaTokens — inflation must stay visible", () => {
    const parsed = overlayTokenSaverEventSchema.parse({
      ...base,
      rawTokens: 900,
      returnedTokens: 1300,
      deltaTokens: -400,
    });
    expect(parsed.deltaTokens).toBe(-400);
    expect(deltaTokensOf(parsed)).toBe(-400);
  });

  it("rejects a negative rawTokens — a count cannot be below zero", () => {
    expect(() => overlayTokenSaverEventSchema.parse({ ...base, rawTokens: -1 })).toThrow();
  });

  it("never derives deltaTokens from bytes when the field is absent", () => {
    const parsed = overlayTokenSaverEventSchema.parse({ ...base, rawTokens: 900 });
    expect(deltaTokensOf(parsed)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/stats exec vitest run test/event.test.ts`
Expected: FAIL — `deltaTokensOf` is not exported.

- [ ] **Step 3: Implement**

In `packages/stats/src/event.ts`, beside `deltaBytesField`:

```typescript
// Measured with the real tokenizer at the write boundary. Optional so every
// pre-measurement row keeps parsing — absence means UNMEASURED, never zero and
// never bytes/4. Signed like deltaBytes: negative means the rewrite inflated.
const tokenCountField = z.number().int().nonnegative().optional();
const deltaTokensField = z.number().int().optional();
```

Add to BOTH `tokenSaverEventSchema` and `overlayTokenSaverEventSchema` (inside `.object({...})`, before `.strict()`):

```typescript
    rawTokens: tokenCountField,
    returnedTokens: tokenCountField,
    deltaTokens: deltaTokensField,
```

Add beside `deltaBytesOf`:

```typescript
// Deliberately NOT falling back to tokensFromBytes(deltaBytes): a caller that
// cannot tell a measured token from an estimated one will mix them into one
// total. Callers that want the estimate ask for it explicitly and report the
// split (see estimated-value.ts).
export function deltaTokensOf(event: { deltaTokens?: number | undefined }): number | undefined {
  return event.deltaTokens;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @megasaver/stats exec vitest run test/event.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/event.ts packages/stats/test/event.test.ts
git commit -m "feat(stats): carry measured token counts on events"
```

---

## Task 2: Pinned published price table

**Files:**
- Create: `scripts/model-list-prices.json`
- Create: `packages/stats/src/model-prices.ts`
- Test: `packages/stats/test/model-prices.test.ts`

**Interfaces:**
- Produces: `modelPriceTableSchema`, `ModelPriceTable`, `loadModelPriceTable(raw: unknown)`, `inputPricePerMTok(table, modelId?)`, `PriceTableError`.

- [ ] **Step 1: Create the table**

Create `scripts/model-list-prices.json`. **Replace the numbers below with your own reading of the vendors' published pricing pages on the day you implement this, and set `capturedAt` to that date.** The tests never assert a price, so accurate numbers are your responsibility, not the suite's.

```json
{
  "capturedAt": "2026-08-01",
  "source": "public pricing pages, USD per million input tokens",
  "unknownModelId": "claude-sonnet-5",
  "prices": {
    "claude-opus-5": { "inputPerMTokUsd": 15.0 },
    "claude-sonnet-5": { "inputPerMTokUsd": 3.0 },
    "claude-haiku-4-5": { "inputPerMTokUsd": 0.8 }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/stats/test/model-prices.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PriceTableError, inputPricePerMTok, loadModelPriceTable } from "../src/model-prices.js";

const valid = {
  capturedAt: "2026-08-01",
  source: "public pricing pages, USD per million input tokens",
  unknownModelId: "claude-sonnet-5",
  prices: {
    "claude-opus-5": { inputPerMTokUsd: 15 },
    "claude-sonnet-5": { inputPerMTokUsd: 3 },
  },
};

describe("model-prices", () => {
  it("rejects a table with no capture date — an undated price is an undated claim", () => {
    const { capturedAt: _drop, ...undated } = valid;
    try {
      loadModelPriceTable(undated);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PriceTableError);
      expect((err as PriceTableError).code).toBe("missing_capture_date");
    }
  });

  it("rejects a table whose unknownModelId has no price entry", () => {
    try {
      loadModelPriceTable({ ...valid, unknownModelId: "not-in-table" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as PriceTableError).code).toBe("unknown_fallback_unpriced");
    }
  });

  it("prices a known model from the table", () => {
    const table = loadModelPriceTable(valid);
    expect(inputPricePerMTok(table, "claude-opus-5")).toEqual({ usd: 15, resolvedAs: "known" });
  });

  it("prices an absent model id at the declared fallback, flagged as unknown", () => {
    const table = loadModelPriceTable(valid);
    expect(inputPricePerMTok(table, undefined)).toEqual({ usd: 3, resolvedAs: "unknown" });
    expect(inputPricePerMTok(table, "some-other-model")).toEqual({ usd: 3, resolvedAs: "unknown" });
  });

  // Shape and date only. Asserting a number here would turn the suite red the
  // day a vendor changes its page, which is not a defect in this repo.
  it("ships a shipped table that parses and carries a date", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "..", "..", "scripts", "model-list-prices.json"), "utf8"),
    );
    const table = loadModelPriceTable(raw);
    expect(table.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(table.prices).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @megasaver/stats exec vitest run test/model-prices.test.ts`
Expected: FAIL — cannot resolve `../src/model-prices.js`.

- [ ] **Step 4: Implement**

Create `packages/stats/src/model-prices.ts`:

```typescript
import { z } from "zod";

export type PriceTableErrorCode =
  | "missing_capture_date"
  | "unknown_fallback_unpriced"
  | "schema_invalid";

export class PriceTableError extends Error {
  readonly code: PriceTableErrorCode;
  constructor(code: PriceTableErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PriceTableError";
    this.code = code;
  }
}

export const modelPriceTableSchema = z.object({
  // Rendered with every estimate. A price table with no date is an undated claim.
  capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  unknownModelId: z.string().min(1),
  prices: z.record(z.object({ inputPerMTokUsd: z.number().nonnegative() })),
});

export type ModelPriceTable = z.infer<typeof modelPriceTableSchema>;

export function loadModelPriceTable(raw: unknown): ModelPriceTable {
  const parsed = modelPriceTableSchema.safeParse(raw);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    if (path === "capturedAt") {
      throw new PriceTableError("missing_capture_date", "price table needs a capturedAt date");
    }
    throw new PriceTableError("schema_invalid", parsed.error.issues[0]?.message ?? "invalid table");
  }
  if (!parsed.data.prices[parsed.data.unknownModelId]) {
    throw new PriceTableError(
      "unknown_fallback_unpriced",
      `unknownModelId "${parsed.data.unknownModelId}" has no price entry`,
    );
  }
  return parsed.data;
}

export interface ResolvedPrice {
  usd: number;
  resolvedAs: "known" | "unknown";
}

// An unresolved model is priced at the declared fallback AND reported as
// unknown, so a window that is mostly unknown cannot read as mostly known.
export function inputPricePerMTok(table: ModelPriceTable, modelId?: string): ResolvedPrice {
  const hit = modelId ? table.prices[modelId] : undefined;
  if (hit) return { usd: hit.inputPerMTokUsd, resolvedAs: "known" };
  const fallback = table.prices[table.unknownModelId];
  if (!fallback) throw new PriceTableError("unknown_fallback_unpriced");
  return { usd: fallback.inputPerMTokUsd, resolvedAs: "unknown" };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @megasaver/stats exec vitest run test/model-prices.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/model-list-prices.json packages/stats/src/model-prices.ts packages/stats/test/model-prices.test.ts
git commit -m "feat(stats): pin dated published model list prices"
```

---

## Task 3: Signed valuation with coverage and unknown share

**Files:**
- Create: `packages/stats/src/estimated-value.ts`
- Test: `packages/stats/test/estimated-value.test.ts`

**Interfaces:**
- Consumes: `ModelPriceTable`, `inputPricePerMTok` (Task 2); `deltaTokensOf` (Task 1); `tokensFromBytes` (existing, `./honest-metrics.js`).
- Produces: `estimateSavedValue(rows, table): SavedValueEstimate`.

- [ ] **Step 1: Write the failing test**

Create `packages/stats/test/estimated-value.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { estimateSavedValue } from "../src/estimated-value.js";
import { loadModelPriceTable } from "../src/model-prices.js";

const table = loadModelPriceTable({
  capturedAt: "2026-08-01",
  source: "test",
  unknownModelId: "claude-sonnet-5",
  prices: {
    "claude-opus-5": { inputPerMTokUsd: 15 },
    "claude-sonnet-5": { inputPerMTokUsd: 3 },
  },
});

describe("estimated-value", () => {
  it("sums measured tokens per model at that model's price", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: 1_000_000, modelId: "claude-sonnet-5", deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(2_000_000);
    expect(out.estimatedUsd).toBeCloseTo(18, 10);
    expect(out.unknownModelTokenShare).toBe(0);
    expect(out.measuredCoverage).toBe(1);
  });

  it("keeps the estimate negative when recovery outweighed compression", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -2_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(-1_000_000);
    expect(out.estimatedUsd).toBeCloseTo(-15, 10);
  });

  it("prices an unknown model at the fallback and raises the unknown share", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: 1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.estimatedUsd).toBeCloseTo(18, 10);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.5, 10);
  });

  // The shares must be computed on MAGNITUDE, not on the signed net. With one
  // positive known row and one negative unknown row the net is exactly zero, so
  // a net-based share reports 0% unknown for a window that is half unknown —
  // and the all-positive test above cannot see the difference, because there
  // Math.abs is the identity. (Added after mutation 4 survived the original
  // suite; see the mutation table in Step 5.)
  it("reports the unknown share on magnitude when signs differ and the net is zero", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.netTokensMeasured).toBe(0);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.5, 10);
  });

  it("keeps the unknown share a proportion — never negative, never above 1", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 3_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaTokens: -1_000_000, deltaBytes: 0 },
      ],
      table,
    );

    expect(out.unknownModelTokenShare).toBeGreaterThanOrEqual(0);
    expect(out.unknownModelTokenShare).toBeLessThanOrEqual(1);
    expect(out.unknownModelTokenShare).toBeCloseTo(0.25, 10);
  });

  it("reports coverage below 1 when a row carries no measured tokens", () => {
    const out = estimateSavedValue(
      [
        { deltaTokens: 1_000_000, modelId: "claude-opus-5", deltaBytes: 0 },
        { deltaBytes: 4_000_000, modelId: "claude-opus-5" },
      ],
      table,
    );

    expect(out.measuredCoverage).toBeCloseTo(0.5, 10);
    // The unmeasured row's bytes are reported separately, never folded into
    // netTokensMeasured — a measured total must contain only measured tokens.
    expect(out.netTokensMeasured).toBe(1_000_000);
    expect(out.unmeasuredTokensEstimated).toBe(1_000_000);
  });

  it("returns zeroed totals and full coverage for an empty window", () => {
    const out = estimateSavedValue([], table);
    expect(out.netTokensMeasured).toBe(0);
    expect(out.estimatedUsd).toBe(0);
    expect(out.measuredCoverage).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/stats exec vitest run test/estimated-value.test.ts`
Expected: FAIL — cannot resolve `../src/estimated-value.js`.

- [ ] **Step 3: Implement**

Create `packages/stats/src/estimated-value.ts`:

```typescript
import { tokensFromBytes } from "./honest-metrics.js";
import { type ModelPriceTable, inputPricePerMTok } from "./model-prices.js";

export interface ValuedRow {
  deltaTokens?: number | undefined;
  deltaBytes?: number | undefined;
  modelId?: string | undefined;
}

export interface SavedValueEstimate {
  // Measured tokens ONLY. Never mixed with the bytes/4 fallback below.
  netTokensMeasured: number;
  // The bytes/4 reading of rows that carry no measured tokens, reported so a
  // partially-measured window cannot look fully measured.
  unmeasuredTokensEstimated: number;
  measuredCoverage: number;
  unknownModelTokenShare: number;
  // Signed. Negative when recovery outweighed compression — displayed, not clamped.
  estimatedUsd: number;
  capturedAt: string;
}

export function estimateSavedValue(
  rows: readonly ValuedRow[],
  table: ModelPriceTable,
): SavedValueEstimate {
  let netTokensMeasured = 0;
  let unmeasuredTokensEstimated = 0;
  let measuredRows = 0;
  let unknownMagnitude = 0;
  let totalMagnitude = 0;
  let estimatedUsd = 0;

  for (const row of rows) {
    if (row.deltaTokens === undefined) {
      unmeasuredTokensEstimated += tokensFromBytes(row.deltaBytes ?? 0);
      continue;
    }
    measuredRows += 1;
    netTokensMeasured += row.deltaTokens;

    const price = inputPricePerMTok(table, row.modelId);
    estimatedUsd += (row.deltaTokens * price.usd) / 1_000_000;

    // Shares are computed on MAGNITUDE: a window with +1M known and -1M
    // unknown has a zero net, and a share computed on the net would divide by
    // zero or report 0% unknown for a window that is half unknown.
    const magnitude = Math.abs(row.deltaTokens);
    totalMagnitude += magnitude;
    if (price.resolvedAs === "unknown") unknownMagnitude += magnitude;
  }

  return {
    netTokensMeasured,
    unmeasuredTokensEstimated,
    measuredCoverage: rows.length === 0 ? 1 : measuredRows / rows.length,
    unknownModelTokenShare: totalMagnitude === 0 ? 0 : unknownMagnitude / totalMagnitude,
    estimatedUsd,
    capturedAt: table.capturedAt,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @megasaver/stats exec vitest run test/estimated-value.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the mutations are caught**

Apply each, confirm a test fails, revert:

| # | Mutation | Must fail |
|---|---|---|
| 1 | `netTokensMeasured = Math.max(0, ...)` (clamp) | negative-window test |
| 2 | Fold `unmeasuredTokensEstimated` into `netTokensMeasured` | coverage test |
| 3 | Skip `unknownMagnitude` accumulation | unknown-share test |
| 4 | `const magnitude = row.deltaTokens` (net, not magnitude) | **the two mixed-sign tests** — "unknown share on magnitude when signs differ" and "keeps the unknown share a proportion" |

> Mutation 4 originally listed the all-positive unknown-share test as its
> guard. It survived: with both rows at `+1_000_000`, `Math.abs` is the
> identity, so the mutation changed nothing observable. Verified after adding
> the two mixed-sign tests above — the mutation now fails both, the second
> showing the net version producing a `-0.5` "proportion". A mutation table
> entry is a claim about a specific test; check it, do not assume it.

- [ ] **Step 6: Commit**

```bash
git add packages/stats/src/estimated-value.ts packages/stats/test/estimated-value.test.ts
git commit -m "feat(stats): value saved tokens, signed, with coverage"
```

---

## Task 4: Model-id resolution (pure)

**Files:**
- Create: `packages/stats/src/model-provenance.ts`
- Test: `packages/stats/test/model-provenance.test.ts`

**Interfaces:**
- Produces: `resolveModelId(input: ModelResolutionInput): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `packages/stats/test/model-provenance.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveModelId } from "../src/model-provenance.js";

const at = Date.parse("2026-08-01T12:00:00.000Z");

describe("model-provenance", () => {
  it("prefers a proxy usage row inside the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [{ atMs: at - 5_000, modelId: "claude-opus-5" }],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-opus-5");
  });

  it("ignores a proxy row outside the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [{ atMs: at - 600_000, modelId: "claude-opus-5" }],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("falls back to the configured default when no proxy row exists", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("returns undefined when nothing is known — it never guesses", () => {
    expect(resolveModelId({ eventAtMs: at, windowMs: 60_000, proxyRows: [] })).toBeUndefined();
  });

  it("picks the closest proxy row when several are in the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [
          { atMs: at - 30_000, modelId: "claude-haiku-4-5" },
          { atMs: at - 1_000, modelId: "claude-opus-5" },
        ],
      }),
    ).toBe("claude-opus-5");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/stats exec vitest run test/model-provenance.test.ts`
Expected: FAIL — cannot resolve `../src/model-provenance.js`.

- [ ] **Step 3: Implement**

Create `packages/stats/src/model-provenance.ts`:

```typescript
export interface ProxyModelRow {
  atMs: number;
  modelId: string;
}

export interface ModelResolutionInput {
  eventAtMs: number;
  windowMs: number;
  proxyRows: readonly ProxyModelRow[];
  configuredDefaultModelId?: string | undefined;
}

// Order: observed (proxy ledger) -> declared (operator config) -> unknown.
// There is no fourth step. The saver hook does not see the model, and a guess
// dressed as provenance is worse than an honest absence: an absent id is
// priced at the fallback AND counted in the visible unknown share, while a
// guess is counted as known.
export function resolveModelId(input: ModelResolutionInput): string | undefined {
  let best: ProxyModelRow | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const row of input.proxyRows) {
    const distance = Math.abs(row.atMs - input.eventAtMs);
    if (distance <= input.windowMs && distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }

  return best?.modelId ?? input.configuredDefaultModelId;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @megasaver/stats exec vitest run test/model-provenance.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/model-provenance.ts packages/stats/test/model-provenance.test.ts
git commit -m "feat(stats): resolve model id from proxy or config only"
```

---

## Task 5: Measure at the write site

**Files:**
- Modify: `packages/context-gate/src/record-output.ts` (the `appendOverlayEvent` call, ~line 383)
- Test: `packages/context-gate/test/record-output-tokens.test.ts`

**Interfaces:**
- Consumes: `countTokens` from `@megasaver/output-filter`; `isStoreFresh` from `@megasaver/stats`.
- Produces: overlay events carrying `rawTokens` / `returnedTokens` / `deltaTokens` / `isFreshStore` when measurable.

The raw text is `input.raw`; the model-facing returned text is `finalText`
(`record-output.ts:312`, where `finalReturnedBytes` is computed from it).
`recordAndFilterOverlayOutput` is already `async`, so `await` is available.

- [ ] **Step 1: Write the failing test**

Create `packages/context-gate/test/record-output-tokens.test.ts`. Follow the
existing `record-output` test's fixture setup (temp store root, a small raw
payload above the mode floor) and add:

```typescript
it("carries measured token counts matching the tokenizer on the same text", async () => {
  const { event } = await runFixture({ raw: LARGE_RAW });

  expect(event.rawTokens).toBe(await countTokens(LARGE_RAW));
  expect(event.returnedTokens).toBeGreaterThan(0);
  expect(event.deltaTokens).toBe((event.rawTokens ?? 0) - (event.returnedTokens ?? 0));
});

it("OMITS the token fields when the tokenizer fails — never bytes/4", async () => {
  const { event } = await runFixture({ raw: LARGE_RAW, countTokens: async () => { throw new Error("boom"); } });

  expect(event.rawTokens).toBeUndefined();
  expect(event.returnedTokens).toBeUndefined();
  expect(event.deltaTokens).toBeUndefined();
  // The rest of the row is intact — a tokenizer failure is not an event failure.
  expect(event.deltaBytes).toBeGreaterThan(0);
});

it("records store freshness", async () => {
  const { event } = await runFixture({ raw: LARGE_RAW });
  expect(typeof event.isFreshStore).toBe("boolean");
});
```

Inject the counter through an optional parameter on the record function
(`countTokensImpl?: (text: string) => Promise<number>`, defaulting to the real
`countTokens`) so the failure path is testable without mocking the module.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/record-output-tokens.test.ts`
Expected: FAIL — `event.rawTokens` is undefined on the happy path.

- [ ] **Step 3: Implement**

In `record-output.ts`, before the `appendOverlayEvent` call:

```typescript
// Measured over the SAME two texts deltaBytes is computed over, so bytes and
// tokens describe one object. A failure or a slow lazy encoder load yields
// OMITTED fields — a value in a field named rawTokens is measured or absent.
const counter = input.countTokensImpl ?? countTokens;
let tokenFields: {
  rawTokens?: number;
  returnedTokens?: number;
  deltaTokens?: number;
} = {};
try {
  const [rawTokens, returnedTokens] = await Promise.race([
    Promise.all([counter(input.raw), counter(finalText)]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("token_budget_exceeded")), TOKEN_COUNT_BUDGET_MS),
    ),
  ]);
  tokenFields = { rawTokens, returnedTokens, deltaTokens: rawTokens - returnedTokens };
} catch {
  tokenFields = {};
}
```

Add `export const TOKEN_COUNT_BUDGET_MS = 50;` near the top, and spread
`...tokenFields` plus `isFreshStore: isStoreFresh(input.storeRoot)` into the
event object passed to `appendOverlayEvent`.

> Clear the timer in a `finally` so the losing timeout cannot hold the CLI's
> event loop open — the same leak fixed in `warmstart-pack.ts` this week.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/record-output-tokens.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Measure the real budget**

Run `countTokens` over the largest payload in the existing fixtures and record
the p95. If it exceeds 50 ms, raise `TOKEN_COUNT_BUDGET_MS` to the measured p95
× 2 and note the measurement in the commit body. **Do not lower it to make a
test pass.**

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/record-output.ts packages/context-gate/test/record-output-tokens.test.ts
git commit -m "feat(context-gate): measure tokens at the event boundary"
```

---

## Task 6: Token-first audit render

**Files:**
- Modify: `apps/cli/src/commands/audit/shared.ts` (lines 71-88)
- Modify: `packages/stats/src/index.ts` (export Tasks 2-4)
- Test: `apps/cli/test/commands/audit-token-headline.test.ts`

**Interfaces:**
- Consumes: `estimateSavedValue`, `loadModelPriceTable` (Tasks 2-3).

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/commands/audit-token-headline.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderSavedValueLines } from "../../src/commands/audit/shared.js";

const estimate = {
  netTokensMeasured: 1_284_300,
  unmeasuredTokensEstimated: 0,
  measuredCoverage: 1,
  unknownModelTokenShare: 0.27,
  estimatedUsd: 8.42,
  capturedAt: "2026-08-01",
};

describe("audit token headline", () => {
  it("puts tokens above dollars", () => {
    const lines = renderSavedValueLines(estimate);
    const tokenLine = lines.findIndex((l) => l.includes("1,284,300"));
    const dollarLine = lines.findIndex((l) => l.includes("8.42"));

    expect(tokenLine).toBeGreaterThanOrEqual(0);
    expect(tokenLine).toBeLessThan(dollarLine);
  });

  it("never renders a dollar figure without (est.), the date, and the caveat", () => {
    const joined = renderSavedValueLines(estimate).join("\n");

    expect(joined).toContain("(est.)");
    expect(joined).toContain("2026-08-01");
    expect(joined.toLowerCase()).toContain("upper bound");
  });

  it("shows the unknown-model share when it is non-zero", () => {
    expect(renderSavedValueLines(estimate).join("\n")).toContain("27%");
  });

  it("prints a coverage line only when coverage is below 100%", () => {
    expect(renderSavedValueLines(estimate).join("\n")).not.toContain("coverage");
    expect(
      renderSavedValueLines({ ...estimate, measuredCoverage: 0.84 }).join("\n"),
    ).toContain("84%");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/audit-token-headline.test.ts`
Expected: FAIL — `renderSavedValueLines` is not exported.

- [ ] **Step 3: Implement**

Add to `apps/cli/src/commands/audit/shared.ts`:

```typescript
import type { SavedValueEstimate } from "@megasaver/stats";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

// Tokens first, dollars subordinate. The dollar line may not be emitted without
// its date and its upper-bound caveat, so no caller can render a bare figure.
export function renderSavedValueLines(estimate: SavedValueEstimate): string[] {
  const lines = [
    `Tokens saved (net, measured):  ${estimate.netTokensMeasured.toLocaleString("en-US")}`,
    `Estimated value:               ~$${estimate.estimatedUsd.toFixed(2)}  (est.)`,
    `  published list input rates, captured ${estimate.capturedAt}`,
    "  upper bound — ignores prompt-cache discounts on tokens that would have",
    "  been re-read rather than re-sent",
  ];
  if (estimate.unknownModelTokenShare > 0) {
    lines.push(`  unknown-model share: ${pct(estimate.unknownModelTokenShare)}`);
  }
  if (estimate.measuredCoverage < 1) {
    lines.push(
      `measured coverage: ${pct(estimate.measuredCoverage)} of rows (rest pre-measurement, read as bytes/4)`,
    );
  }
  return lines;
}
```

Then export the Task 2-4 surface from `packages/stats/src/index.ts`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/audit-token-headline.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the repo gate**

Run: `pnpm verify`
Expected: all turbo tasks green, conventions sync `ok`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/audit/shared.ts packages/stats/src/index.ts apps/cli/test/commands/audit-token-headline.test.ts
git commit -m "feat(cli): headline measured tokens, dollars as estimate"
```

---

## Task 7: Field evidence (operator — this is the point of the spec)

**Files:** none. This task produces evidence, not code.

Tests cannot satisfy this. The finding it closes is that every savings number in
the wiki came from the benchmark harness, never from a real session.

- [ ] **Step 1: Install the saver hook on this machine**

Run: `mega hooks install` then `mega hooks status`
Expected: the Claude Code PostToolUse hook is present.

- [ ] **Step 2: Enable the saver for a real workspace**

Run: `mega session saver default enable`
Expected: status reports the mode and the scope it wrote.

- [ ] **Step 3: Do real work**

Use Claude Code normally in that workspace until at least one tool output
clears the mode floor (a wide grep or a large file read).

- [ ] **Step 4: Confirm a measured row exists**

Run: `mega audit`
Expected: the token headline renders with a non-zero
`Tokens saved (net, measured)`, and the dollar line carries `(est.)`, the
capture date, and the caveat.

If `Tokens saved (net, measured)` is 0 while bytes are non-zero, the tokenizer
path is failing silently — investigate before proceeding. **Do not** report the
bytes/4 number as the token number.

- [ ] **Step 5: Archive the evidence and log it**

Capture the terminal output into the wiki log entry, and update
`wiki/syntheses/saver-root-cause-2026-07-28.md` §E: either its "no field
telemetry exists" finding gets its closing evidence, or record honestly that the
saver still is not installed here and this item remains open.

```bash
git add wiki/log.md wiki/syntheses/saver-root-cause-2026-07-28.md
git commit -m "docs(wiki): record first measured-token field evidence"
```

---

## Review Gates

- [ ] `code-reviewer` pass in a separate context (MEDIUM risk).
- [ ] Author ≠ reviewer.
- [ ] Changeset added for the `@megasaver/stats` public surface.

The question the reviewer must answer: **can any number in the audit output be
an estimate wearing a measurement's name?** That is the defect class this spec
exists to remove, and it has recurred three times in this repo.
