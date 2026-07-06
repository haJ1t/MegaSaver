# Pro module 2 — waste/efficiency insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD. Build touched packages after src edits. `pnpm verify` at slice boundaries. Risk MEDIUM → code-reviewer + critic.

**Goal:** A second proprietary Pro module — `mega savings insights` — that breaks down where tokens are still being spent (waste by source/label) on the same offline-license entitlement, reusing module 1's gated-command pattern.

**Architecture:** Two pure functions in `packages/pro-analytics` (proprietary) consume already-validated `TokenSaverEvent`s and return a waste breakdown + a headline. A new gated CLI command mirrors `runSavingsHistory`: `checkEntitlement("savings-analytics")` first → honest upsell + exit 0 if not entitled; else lazy-import + render. No change to the security-critical `@megasaver/entitlement` package.

**Tech Stack:** TypeScript ESM, Vitest, Citty. Packages: `packages/pro-analytics`, `apps/cli`. Reuses `@megasaver/stats` (`tokensFromBytes`, `INPUT_PRICE_PER_MTOK_USD`, `TokenSaverEvent`), `@megasaver/core` (`formatDollarsSaved`), `@megasaver/entitlement` (`checkEntitlement`).

**Spec:** `docs/superpowers/specs/2026-07-06-pro-insights-design.md`.

**Anchors:**
- `packages/pro-analytics/src/history.ts` — the existing pure-fn style (`dollarsFromTokens`, `accumulate`, aggregate then map + sort).
- `packages/pro-analytics/src/index.ts` — the export surface.
- `apps/cli/src/commands/savings/history.ts` — the gated-command template (checkEntitlement first, upsell, lazy import, `renderTable` flooring `dollarsSaved`, `--json/--csv/--out`).
- `apps/cli/src/commands/savings/shared.ts` — `PRO_ANALYTICS_UPSELL`, `SavingsEventReader`, `defaultSavingsEventReader`.
- `apps/cli/src/commands/savings/index.ts` — the `savings` group registration.
- `apps/cli/test/commands/savings.test.ts` — the existing gated-command test patterns (inject publicKey + store + a signed test license).

---

## Slice A — `pro-analytics` waste insights (proprietary, pure)

### Task A1: `computeWasteBreakdown`

**Files:**
- Create: `packages/pro-analytics/src/insights.ts`
- Modify: `packages/pro-analytics/src/index.ts`
- Test: `packages/pro-analytics/test/insights.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/pro-analytics/test/insights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeWasteBreakdown } from "../src/insights.js";

// Minimal TokenSaverEvent-shaped fixtures. Only the fields insights reads matter;
// the rest are filled to satisfy the type without affecting the math.
function ev(
  partial: {
    sourceKind: string;
    label: string;
    rawBytes: number;
    returnedBytes: number;
    bytesSaved: number;
  },
  i: number,
) {
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: "2026-07-01T00:00:00.000Z",
    sourceKind: partial.sourceKind,
    label: partial.label,
    rawBytes: partial.rawBytes,
    returnedBytes: partial.returnedBytes,
    bytesSaved: partial.bytesSaved,
    savingRatio: partial.rawBytes === 0 ? 0 : partial.bytesSaved / partial.rawBytes,
    summary: "",
    mode: "safe",
  } as never;
}

describe("computeWasteBreakdown", () => {
  it("groups by source, aggregates, ratios, sorts by returnedBytes desc", () => {
    const events = [
      // command: raw 1000, returned 900, saved 100 (poor compression, biggest returned)
      ev({ sourceKind: "command", label: "test", rawBytes: 1000, returnedBytes: 900, bytesSaved: 100 }, 0),
      ev({ sourceKind: "command", label: "test", rawBytes: 1000, returnedBytes: 900, bytesSaved: 100 }, 1),
      // file: raw 1000, returned 100, saved 900 (good compression, small returned)
      ev({ sourceKind: "file", label: "read", rawBytes: 1000, returnedBytes: 100, bytesSaved: 900 }, 2),
    ];
    const rows = computeWasteBreakdown(events, { by: "source" });
    expect(rows.map((r) => r.key)).toEqual(["command", "file"]); // 1800 returned > 100
    const cmd = rows[0]!;
    expect(cmd.events).toBe(2);
    expect(cmd.rawBytes).toBe(2000);
    expect(cmd.returnedBytes).toBe(1800);
    expect(cmd.bytesSaved).toBe(200);
    expect(cmd.savingRatio).toBeCloseTo(200 / 2000); // aggregate, not mean
    expect(cmd.returnedShare).toBeCloseTo(1800 / 1900);
    const file = rows[1]!;
    expect(file.returnedShare).toBeCloseTo(100 / 1900);
  });

  it("breaks ties by key asc", () => {
    const events = [
      ev({ sourceKind: "b", label: "x", rawBytes: 100, returnedBytes: 50, bytesSaved: 50 }, 0),
      ev({ sourceKind: "a", label: "y", rawBytes: 100, returnedBytes: 50, bytesSaved: 50 }, 1),
    ];
    expect(computeWasteBreakdown(events, { by: "source" }).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("groups by label when by=label", () => {
    const events = [
      ev({ sourceKind: "command", label: "grep", rawBytes: 100, returnedBytes: 80, bytesSaved: 20 }, 0),
      ev({ sourceKind: "command", label: "cat", rawBytes: 100, returnedBytes: 10, bytesSaved: 90 }, 1),
    ];
    expect(computeWasteBreakdown(events, { by: "label" }).map((r) => r.key)).toEqual(["grep", "cat"]);
  });

  it("rawBytes 0 -> savingRatio 0, no NaN", () => {
    const rows = computeWasteBreakdown(
      [ev({ sourceKind: "x", label: "x", rawBytes: 0, returnedBytes: 0, bytesSaved: 0 }, 0)],
      { by: "source" },
    );
    expect(rows[0]!.savingRatio).toBe(0);
    expect(Number.isNaN(rows[0]!.savingRatio)).toBe(false);
  });

  it("empty -> []", () => {
    expect(computeWasteBreakdown([], { by: "source" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @megasaver/pro-analytics test` — Expected: FAIL (module/insights not found).

- [ ] **Step 3: Implement** `packages/pro-analytics/src/insights.ts`:

```ts
import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";

export type WasteBy = "source" | "label";

export interface WasteRow {
  key: string;
  events: number;
  rawBytes: number;
  returnedBytes: number;
  bytesSaved: number;
  tokensReturned: number;
  tokensSaved: number;
  dollarsReturned: number;
  dollarsSaved: number;
  savingRatio: number;
  returnedShare: number;
}

// Same flat per-MTok input price the free headline + module 1 use.
function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

type Acc = { rawBytes: number; returnedBytes: number; bytesSaved: number; events: number };

export function computeWasteBreakdown(
  events: readonly TokenSaverEvent[],
  opts: { by: WasteBy },
): WasteRow[] {
  const keyOf = opts.by === "label" ? (e: TokenSaverEvent) => e.label : (e: TokenSaverEvent) => e.sourceKind;
  const byKey = new Map<string, Acc>();
  let totalReturned = 0;
  for (const e of events) {
    const k = keyOf(e);
    const acc = byKey.get(k) ?? { rawBytes: 0, returnedBytes: 0, bytesSaved: 0, events: 0 };
    acc.rawBytes += e.rawBytes;
    acc.returnedBytes += e.returnedBytes;
    acc.bytesSaved += e.bytesSaved;
    acc.events += 1;
    byKey.set(k, acc);
    totalReturned += e.returnedBytes;
  }
  return [...byKey.entries()]
    .map(([key, a]) => {
      const tokensReturned = tokensFromBytes(a.returnedBytes);
      const tokensSaved = tokensFromBytes(a.bytesSaved);
      return {
        key,
        events: a.events,
        rawBytes: a.rawBytes,
        returnedBytes: a.returnedBytes,
        bytesSaved: a.bytesSaved,
        tokensReturned,
        tokensSaved,
        dollarsReturned: dollarsFromTokens(tokensReturned),
        dollarsSaved: dollarsFromTokens(tokensSaved),
        savingRatio: a.rawBytes === 0 ? 0 : a.bytesSaved / a.rawBytes,
        returnedShare: totalReturned === 0 ? 0 : a.returnedBytes / totalReturned,
      };
    })
    .sort((x, y) => y.returnedBytes - x.returnedBytes || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/pro-analytics test`.

- [ ] **Step 5: Commit** `feat(pro-analytics): waste breakdown by source/label`.

### Task A2: `computeWasteHeadline` + export

**Files:**
- Modify: `packages/pro-analytics/src/insights.ts`, `packages/pro-analytics/src/index.ts`
- Test: `packages/pro-analytics/test/insights.test.ts`

- [ ] **Step 1: Write the failing test** — append to `insights.test.ts`:

```ts
import { computeWasteHeadline } from "../src/insights.js";

describe("computeWasteHeadline", () => {
  it("totals, overall ratio, top source by returnedBytes", () => {
    const events = [
      ev({ sourceKind: "command", label: "t", rawBytes: 1000, returnedBytes: 900, bytesSaved: 100 }, 0),
      ev({ sourceKind: "file", label: "r", rawBytes: 1000, returnedBytes: 100, bytesSaved: 900 }, 1),
    ];
    const h = computeWasteHeadline(events);
    expect(h.totalRawBytes).toBe(2000);
    expect(h.totalReturnedBytes).toBe(1000);
    expect(h.totalBytesSaved).toBe(1000);
    expect(h.overallSavingRatio).toBeCloseTo(0.5);
    expect(h.topKey).toBe("command");
    expect(h.topReturnedShare).toBeCloseTo(0.9);
  });

  it("empty -> zeros + null topKey", () => {
    const h = computeWasteHeadline([]);
    expect(h.totalReturnedBytes).toBe(0);
    expect(h.overallSavingRatio).toBe(0);
    expect(h.topKey).toBeNull();
    expect(h.topReturnedShare).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — append to `insights.ts`:

```ts
export interface WasteHeadline {
  totalRawBytes: number;
  totalReturnedBytes: number;
  totalBytesSaved: number;
  tokensReturned: number;
  dollarsReturned: number;
  overallSavingRatio: number;
  topKey: string | null;
  topReturnedShare: number;
}

export function computeWasteHeadline(events: readonly TokenSaverEvent[]): WasteHeadline {
  const bySource = computeWasteBreakdown(events, { by: "source" });
  const totalRawBytes = events.reduce((s, e) => s + e.rawBytes, 0);
  const totalReturnedBytes = events.reduce((s, e) => s + e.returnedBytes, 0);
  const totalBytesSaved = events.reduce((s, e) => s + e.bytesSaved, 0);
  const tokensReturned = tokensFromBytes(totalReturnedBytes);
  const top = bySource[0] ?? null;
  return {
    totalRawBytes,
    totalReturnedBytes,
    totalBytesSaved,
    tokensReturned,
    dollarsReturned: dollarsFromTokens(tokensReturned),
    overallSavingRatio: totalRawBytes === 0 ? 0 : totalBytesSaved / totalRawBytes,
    topKey: top ? top.key : null,
    topReturnedShare: top ? top.returnedShare : 0,
  };
}
```

Then update `packages/pro-analytics/src/index.ts` to add:

```ts
export {
  type WasteBy,
  type WasteRow,
  type WasteHeadline,
  computeWasteBreakdown,
  computeWasteHeadline,
} from "./insights.js";
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/pro-analytics build && pnpm --filter @megasaver/pro-analytics test`.

- [ ] **Step 5: Commit** `feat(pro-analytics): waste headline + insights export`.

**Slice A boundary:** `pnpm --filter @megasaver/pro-analytics build` + test green.

---

## Slice B — gated `mega savings insights`

### Task B1: `runSavingsInsights` (TDD)

**Files:**
- Create: `apps/cli/src/commands/savings/insights.ts`
- Modify: `apps/cli/src/commands/savings/index.ts`
- Test: `apps/cli/test/commands/savings.test.ts`

- [ ] **Step 1: Write the failing test** — add an `insights` block to `apps/cli/test/commands/savings.test.ts`, following the exact pattern already used for `runSavingsHistory` in that file (a `signTestLicense`/keypair helper + a `storeRoot` are already present there — reuse them; do NOT re-invent). `TokenSaverEvent` is imported from `@megasaver/core` in this file.

  **You MUST extend the existing `proSpies` + `vi.mock("@megasaver/pro-analytics")` block** (top of the file) to add `computeWasteBreakdown: vi.fn()` and `computeWasteHeadline: vi.fn()`, each `mockImplementation(actual.…)` and spread into the returned mock — mirroring how `computeSavingsHistory` etc. are wired. Without this, the "upsell path does not compute" assertion cannot be made. Import `runSavingsInsights` from `../../src/commands/savings/index.js`.

  Assertions:
  - no license (empty store) → `runSavingsInsights` stdout contains the upsell text; `readAllEvents` is NOT called AND `proSpies.computeWasteBreakdown`/`computeWasteHeadline` are NOT called; returns 0.
  - valid injected license → stdout contains the top source key + a table header; returns 0.
  - `--json` → parsed stdout is `{ headline, rows }` with `rows` an array.
  - `--csv` → stdout has the CSV header row from `exportSavings`.
  - `--out <tmpfile>` → the file is written and stdout says `Wrote savings insights to <tmpfile>`.
  - events empty (entitled) → `No savings recorded yet.`, returns 0.

  Mirror the shape of the existing history test (same injected deps: `storeRoot`, `now`, `publicKey`, `readAllEvents`, `stdout`, `stderr`). Use a `readAllEvents` stub that returns `{ events: [...], eventsByProject: {...} }` with 2 sources so the breakdown is non-trivial (the discriminating-fixture rule: distinct returnedBytes per source so sort order is observable).

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @megasaver/cli test savings` — Expected: FAIL (insights not found).

- [ ] **Step 3: Implement** `apps/cli/src/commands/savings/insights.ts` — mirror `history.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  PRO_ANALYTICS_UPSELL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./shared.js";

export type InsightsBy = "source" | "label";

export type RunSavingsInsightsInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  by?: InsightsBy;
  json?: boolean;
  csv?: boolean;
  out?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const TABLE_COLUMNS = [
  "key",
  "events",
  "tokensReturned",
  "dollarsReturned",
  "tokensSaved",
  "dollarsSaved",
  "savingRatio",
  "returnedShare",
] as const;

// $ columns floored to the shared display string (formatDollarsSaved), matching
// history.ts + `mega audit report`; ratios to 2dp; everything else verbatim.
function fmt(column: string, value: unknown): string {
  if (column === "dollarsReturned" || column === "dollarsSaved") {
    return formatDollarsSaved(value as number);
  }
  if (column === "savingRatio" || column === "returnedShare") {
    return (value as number).toFixed(2);
  }
  return String(value);
}

function renderTable(rows: readonly Record<string, unknown>[]): string[] {
  const header = TABLE_COLUMNS.join("  ");
  const lines = rows.map((row) => TABLE_COLUMNS.map((c) => fmt(c, row[c])).join("  "));
  return [header, ...lines];
}

export async function runSavingsInsights(input: RunSavingsInsightsInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(PRO_ANALYTICS_UPSELL);
    return 0;
  }

  const { computeWasteBreakdown, computeWasteHeadline, exportSavings } = await import(
    "@megasaver/pro-analytics"
  );

  const { events } = await input.readAllEvents();
  const by: InsightsBy = input.by ?? "source";
  const rows = computeWasteBreakdown(events, { by });
  const headline = computeWasteHeadline(events);

  if (rows.length === 0) {
    input.stdout("No savings recorded yet.");
    return 0;
  }

  let rendered: string;
  if (input.json) {
    rendered = JSON.stringify({ headline, rows });
  } else if (input.csv) {
    rendered = exportSavings(rows as unknown as Record<string, unknown>[], "csv");
  } else {
    const headlineLine =
      headline.topKey === null
        ? "No returned bytes."
        : `Still sending ${headline.tokensReturned} tokens (${formatDollarsSaved(headline.dollarsReturned)}) to the model. Biggest source: ${headline.topKey} (${(headline.topReturnedShare * 100).toFixed(0)}% of returned bytes, ${(headline.overallSavingRatio * 100).toFixed(0)}% overall saved).`;
    rendered = [headlineLine, "", ...renderTable(rows as unknown as Record<string, unknown>[])].join("\n");
  }

  if (input.out !== undefined) {
    writeFileSync(input.out, rendered);
    input.stdout(`Wrote savings insights to ${input.out}`);
  } else {
    input.stdout(rendered);
  }
  return 0;
}

export const savingsInsightsCommand = defineCommand({
  meta: { name: "insights", description: "Where tokens are still spent — waste breakdown (Mega Saver Pro)." },
  args: {
    by: { type: "string", description: "source | label (default: source)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    csv: { type: "boolean", default: false, description: "Emit CSV output." },
    out: { type: "string", description: "Write output to a file instead of stdout." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const by = typeof args.by === "string" ? args.by : undefined;
    const code = await runSavingsInsights({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(by === "source" || by === "label" ? { by } : {}),
      json: !!args.json,
      csv: !!args.csv,
      ...(typeof args.out === "string" ? { out: args.out } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Then register it in `apps/cli/src/commands/savings/index.ts` — add `savingsInsightsCommand` to the imports and to the group's `subCommands` (mirror how `history`/`export` are wired; check the file first).

- [ ] **Step 4: Run → PASS.** `pnpm --filter @megasaver/cli test savings`.

- [ ] **Step 5: Commit** `feat(cli): mega savings insights (Pro-gated)`.

### Task B2: README + changeset

**Files:**
- Modify: `README.md`
- Create: `.changeset/pro-insights.md`

- [ ] **Step 1:** In `README.md`, under the existing Pro section (where `mega savings history`/`export` are documented), add a bullet:

```
- `mega savings insights [--by source|label]` — where your tokens are still
  going: a waste breakdown by source/tool, with per-source saving ratios.
```

Keep the existing honesty disclosure paragraph unchanged.

- [ ] **Step 2:** Create `.changeset/pro-insights.md`:

```md
---
"@megasaver/cli": minor
---

Add `mega savings insights` — a Pro-gated waste/efficiency breakdown (where
tokens are still spent, by source/label) on the existing offline license.
```

- [ ] **Step 3: Commit** `docs(cli): document mega savings insights + changeset`.

**Slice B boundary:** `pnpm verify` green (repo root).

---

## Final gate
- `pnpm verify` green (biome + tsc project refs + vitest).
- **Verifier reproduction:** with a test keypair — `issue.mjs` a key → `mega license activate <key>` → `mega savings insights` shows the breakdown + headline; `--json`/`--csv`/`--out` work; **no license → upsell (exit 0), nothing computed**. Capture output.
- Changeset added.
- code-reviewer + critic (Pro-gated path; the critic runs real experiments in an isolated worktree). Focus: the upsell path never imports/half-runs pro-analytics; `savingRatio`/`returnedShare` are correct + division-guarded; sort/tie-break deterministic; `$` display matches module 1; the gate reuses `checkEntitlement` correctly.

## Deferred
Anomaly/spike alerting; cross-project leaderboard; `--window` filtering; per-event drill-down; Stripe; a third module.
