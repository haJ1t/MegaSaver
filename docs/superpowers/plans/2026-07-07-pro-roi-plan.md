# `mega roi` (Pro module 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated top-level `mega roi` command that divides the current month's measured savings by the Pro price ($7.99 default) and prints an honest ROI multiple (saved-so-far + on-pace month-end projection).

**Architecture:** Fourth proprietary pure-fn module in `@megasaver/pro-analytics` (`computeRoi` wraps the existing `forecastSavings` month window) + a CLI command that mirrors `runSavingsForecast` exactly: entitlement gate FIRST (existing `"savings-analytics"` key, `@megasaver/entitlement` untouched), lazy pro-analytics import, `defaultSavingsEventReader` reuse.

**Tech Stack:** TypeScript strict ESM, Vitest, Citty, pnpm workspaces. Spec: `docs/superpowers/specs/2026-07-07-pro-roi-design.md`.

**Execution notes:**
- Work in a feature worktree (`superpowers:using-git-worktrees`), branch `feat/cli-mega-roi`.
- Run tests from repo root with `pnpm --filter <pkg> exec vitest run <file>`.
- Money math baseline: `tokensFromBytes = bytes/4`; `INPUT_PRICE_PER_MTOK_USD = 3.0` → 4_000_000 bytes = 1_000_000 tokens = $3.00.

---

### Task 1: `computeRoi` pure function (TDD)

**Files:**
- Create: `packages/pro-analytics/test/roi.test.ts`
- Create: `packages/pro-analytics/src/roi.ts`
- Modify: `packages/pro-analytics/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pro-analytics/test/roi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PRO_PRICE_USD_PER_MONTH, computeRoi } from "../src/roi.js";

// tokensFromBytes is bytes/4 (see @megasaver/stats); 4_000_000 bytes → 1_000_000
// tokens → $3.00 at INPUT_PRICE_PER_MTOK_USD = 3.0.
function ev(createdAt: string, bytesSaved: number, i: number) {
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt,
    sourceKind: "file",
    label: "read",
    rawBytes: bytesSaved * 2,
    returnedBytes: bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "",
    mode: "safe",
  } as never;
}

const NOW = Date.UTC(2026, 6, 15, 0, 0, 0); // 2026-07-15T00:00:00Z, mid-July (31-day month)

// Two in-month events: 8_000_000 bytes → 2_000_000 tokens → $6.00 saved so far.
const events = [
  ev("2026-07-05T00:00:00.000Z", 4_000_000, 0),
  ev("2026-07-10T00:00:00.000Z", 4_000_000, 1),
  ev("2026-06-30T00:00:00.000Z", 40_000_000, 2), // previous month → excluded
];

describe("computeRoi", () => {
  it("divides saved and projected dollars by the price", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 7.99 });
    expect(r.period).toBe("month");
    expect(r.priceUsd).toBe(7.99);
    expect(r.savedSoFar.dollars).toBeCloseTo(6);
    expect(r.roiSoFar).toBeCloseTo(6 / 7.99);
    // run-rate: $6 over 14 elapsed days of 31 → ×(31/14) at month end.
    expect(r.projectedEnd.dollars).toBeCloseTo(6 * (31 / 14));
    expect(r.roiProjected).toBeCloseTo((6 * (31 / 14)) / 7.99);
    expect(r.daysLeft).toBeCloseTo(17);
  });

  it("contextWindowsReclaimed = savedTokens / 200_000", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 7.99 });
    expect(r.savedSoFar.tokens).toBe(2_000_000);
    expect(r.contextWindowsReclaimed).toBeCloseTo(10);
  });

  it("paidForItself is >= 1 on the exact boundary", () => {
    expect(computeRoi(events, { now: NOW, priceUsd: 6 }).paidForItself).toBe(true); // 6/6 = 1
    expect(computeRoi(events, { now: NOW, priceUsd: 6.01 }).paidForItself).toBe(false);
  });

  it("priceUsd <= 0 → roi fields 0, no NaN/Infinity", () => {
    const r = computeRoi(events, { now: NOW, priceUsd: 0 });
    expect(r.roiSoFar).toBe(0);
    expect(r.roiProjected).toBe(0);
    expect(r.paidForItself).toBe(false);
    expect(Number.isFinite(r.roiSoFar)).toBe(true);
  });

  it("empty events → zeros, paidForItself false, no NaN", () => {
    const r = computeRoi([], { now: NOW, priceUsd: PRO_PRICE_USD_PER_MONTH });
    expect(r.savedSoFar.tokens).toBe(0);
    expect(r.roiSoFar).toBe(0);
    expect(r.roiProjected).toBe(0);
    expect(r.paidForItself).toBe(false);
    expect(Number.isNaN(r.roiProjected)).toBe(false);
  });

  it("exports the canonical site price", () => {
    expect(PRO_PRICE_USD_PER_MONTH).toBe(7.99);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/roi.test.ts`
Expected: FAIL — `Cannot find module '../src/roi.js'` (or equivalent resolve error).

- [ ] **Step 3: Write minimal implementation**

Create `packages/pro-analytics/src/roi.ts`:

```ts
import { CONTEXT_WINDOW_TOKENS, type TokenSaverEvent } from "@megasaver/stats";
import { forecastSavings } from "./forecast.js";

// The live Gumroad/site price is canonical (user decision 2026-07-07).
export const PRO_PRICE_USD_PER_MONTH = 7.99;

export interface RoiReport {
  period: "month";
  periodStart: string;
  periodEnd: string;
  daysLeft: number;
  priceUsd: number;
  savedSoFar: { bytes: number; tokens: number; dollars: number };
  projectedEnd: { tokens: number; dollars: number };
  roiSoFar: number;
  roiProjected: number;
  contextWindowsReclaimed: number;
  paidForItself: boolean;
}

export function computeRoi(
  events: readonly TokenSaverEvent[],
  opts: { now: number; priceUsd: number },
): RoiReport {
  const f = forecastSavings(events, { now: opts.now, period: "month" });
  // priceUsd<=0 → 0 mirrors budgetPace's amount<=0 rule: never NaN/Infinity.
  const ratio = (dollars: number) => (opts.priceUsd <= 0 ? 0 : dollars / opts.priceUsd);
  const roiSoFar = ratio(f.savedSoFar.dollars);
  return {
    period: "month",
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    daysLeft: f.daysLeft,
    priceUsd: opts.priceUsd,
    savedSoFar: f.savedSoFar,
    projectedEnd: f.projectedEnd,
    roiSoFar,
    roiProjected: ratio(f.projectedEnd.dollars),
    contextWindowsReclaimed: f.savedSoFar.tokens / CONTEXT_WINDOW_TOKENS,
    paidForItself: roiSoFar >= 1,
  };
}
```

Note: if `CONTEXT_WINDOW_TOKENS` is not exported from the `@megasaver/stats` root
(`packages/stats/src/index.ts`), add it to the root export list — it already
exists in `packages/stats/src/savings-headline.ts` and is exported from the
`headline` subpath.

Append to `packages/pro-analytics/src/index.ts`:

```ts
export { type RoiReport, PRO_PRICE_USD_PER_MONTH, computeRoi } from "./roi.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/roi.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the package's full test suite**

Run: `pnpm --filter @megasaver/pro-analytics test`
Expected: PASS — no regressions in history/export/insights/forecast tests.

- [ ] **Step 6: Commit**

```bash
git add packages/pro-analytics/src/roi.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/roi.test.ts
git commit -m "feat(pro-analytics): computeRoi — monthly savings vs Pro price"
```

(If Step 3's note applied, also `git add packages/stats/src/index.ts`.)

---

### Task 2: gated `runRoi` CLI command (TDD)

**Files:**
- Create: `apps/cli/test/commands/roi.test.ts`
- Create: `apps/cli/src/commands/roi.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/commands/roi.test.ts` (harness mirrors
`apps/cli/test/commands/savings.test.ts` — Ed25519 test key, temp store, spy on
the proprietary compute):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenSaverEvent } from "@megasaver/core";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRoi } from "../../src/commands/roi.js";
import type { SavingsEventReader } from "../../src/commands/savings/index.js";

// Spy on the proprietary Pro compute while delegating to the real implementation.
// Gating tests assert it is NEVER invoked on the upsell path — so moving the lazy
// `await import(...)` (or the compute) above the entitlement gate fails a test.
const proSpies = vi.hoisted(() => ({ computeRoi: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.computeRoi.mockImplementation(actual.computeRoi);
  return { ...actual, computeRoi: proSpies.computeRoi };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z — 30-day month, ~13.9 days elapsed
const now = () => NOW_MS;

function event(createdAt: string, bytesSaved: number): TokenSaverEvent {
  return {
    id: `e-${createdAt}-${bytesSaved}`,
    sessionId: "sess-1" as TokenSaverEvent["sessionId"],
    projectId: "proj-1" as TokenSaverEvent["projectId"],
    createdAt,
    sourceKind: "file",
    label: "read",
    rawBytes: bytesSaved * 2,
    returnedBytes: bytesSaved,
    bytesSaved,
    savingRatio: 0.5,
    summary: "s",
    mode: "balanced",
  };
}

// 8_000_000 bytes → 2_000_000 tokens → $6.00 saved this month.
// Default price 7.99 → roiSoFar ≈ 0.75 (NOT paid for itself yet).
// --price $5 → roiSoFar = 1.2 (paid for itself).
const roiEvents: TokenSaverEvent[] = [
  event("2023-11-05T00:00:00.000Z", 4_000_000),
  event("2023-11-10T00:00:00.000Z", 4_000_000),
];

function roiReader(): SavingsEventReader {
  return () => ({ events: roiEvents, eventsByProject: { "proj-1": roiEvents } });
}

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-roi-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.computeRoi.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, {
    v: 1,
    tier: "pro",
    id: "cust-1",
    iat: 0,
    exp: null,
  });
  const res = activateLicense(root, key, { publicKey: keys.publicKey, now });
  expect(res.ok).toBe(true);
}

describe("runRoi — gating", () => {
  it("with NO license: prints the upsell, exit 0, reads NO events, computes nothing", async () => {
    const readAllEvents = vi.fn(roiReader());

    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Mega Saver Pro");
    expect(text).toContain("mega license activate");
    expect(readAllEvents).not.toHaveBeenCalled();
    expect(proSpies.computeRoi).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-5"])(
    "bad --price %s is rejected BEFORE any compute (stderr + exit 1)",
    async (bad) => {
      activatePro();
      const readAllEvents = vi.fn(roiReader());

      const code = await runRoi({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        readAllEvents,
        price: bad,
        stdout,
        stderr,
      });

      expect(code).toBe(1);
      expect(err.join("\n")).toContain("--price");
      expect(out.join("\n")).toBe("");
      expect(readAllEvents).not.toHaveBeenCalled();
      expect(proSpies.computeRoi).not.toHaveBeenCalled();
    },
  );
});

describe("runRoi — render variants (entitled)", () => {
  beforeEach(() => activatePro());

  it("default price: honest ROI<1 headline + (est.) breakdown", async () => {
    const readAllEvents = vi.fn(roiReader());

    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(readAllEvents).toHaveBeenCalledTimes(1);
    expect(proSpies.computeRoi).toHaveBeenCalledTimes(1);
    const text = out.join("\n");
    expect(text).toContain("hasn't paid for itself yet");
    expect(text).toContain("×");
    expect(text).toContain("(est.)");
    expect(text).toContain("$7.99");
  });

  it("--price $5 flips to the paid-for-itself headline (1.2×)", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      price: "$5",
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Pro $5.00/mo");
    expect(text).toContain("1.2×");
    expect(text).toContain("sessions' worth of context");
  });

  it("--price 5 ≡ --price $5 (both dollars)", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      price: "5",
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro $5.00/mo");
  });

  it("--json emits the RoiReport", async () => {
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: roiReader(),
      json: true,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      priceUsd: number;
      roiSoFar: number;
      paidForItself: boolean;
    };
    expect(parsed.priceUsd).toBe(7.99);
    expect(parsed.roiSoFar).toBeCloseTo(6 / 7.99);
    expect(parsed.paidForItself).toBe(false);
  });

  it("no in-month events → 'No savings recorded this month yet.', exit 0", async () => {
    const staleReader: SavingsEventReader = () => ({
      events: [event("2022-11-05T00:00:00.000Z", 4_000_000)],
      eventsByProject: {},
    });
    const code = await runRoi({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      readAllEvents: staleReader,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("No savings recorded this month yet.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/roi.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/roi.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/commands/roi.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { formatDollarsSaved } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  PRO_ANALYTICS_URL,
  type SavingsEventReader,
  defaultSavingsEventReader,
} from "./savings/shared.js";

// roi-specific upsell: the shared PRO_ANALYTICS_UPSELL says "historical savings
// analytics", which would misname this feature. Same activation mechanics.
export const ROI_UPSELL = `ROI reporting is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Boundary parse (§8): the renderer divides by the price, so reject a
// non-finite or non-positive amount here. `$` prefix optional; both dollars.
export function parsePrice(raw: string): number | null {
  const amount = Number(raw.startsWith("$") ? raw.slice(1) : raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export type RunRoiInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  readAllEvents: SavingsEventReader;
  price?: string;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runRoi(input: RunRoiInput): Promise<0 | 1> {
  // The entitlement gate runs FIRST. On the not-entitled path we print an honest
  // upsell and return 0 without importing pro-analytics or reading any events —
  // the Pro compute must never half-run for a free user.
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(ROI_UPSELL);
    return 0;
  }

  let priceOverride: number | null = null;
  if (input.price !== undefined) {
    priceOverride = parsePrice(input.price);
    if (priceOverride === null) {
      input.stderr(
        `Invalid --price ${input.price}: expected a positive dollar amount (e.g. 7.99 or $7.99).`,
      );
      return 1;
    }
  }

  const { PRO_PRICE_USD_PER_MONTH, computeRoi } = await import("@megasaver/pro-analytics");
  const { events } = await input.readAllEvents();
  const report = computeRoi(events, {
    now: input.now(),
    priceUsd: priceOverride ?? PRO_PRICE_USD_PER_MONTH,
  });

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (report.savedSoFar.bytes === 0) {
    input.stdout("No savings recorded this month yet.");
    return 0;
  }

  // The PRICE renders verbatim with two decimals — flooring it through
  // formatDollarsSaved would misstate $7.99 as $7.
  const price = `$${report.priceUsd.toFixed(2)}`;
  const saved = formatDollarsSaved(report.savedSoFar.dollars);
  const proj = formatDollarsSaved(report.projectedEnd.dollars);
  const roiSo = `${report.roiSoFar.toFixed(1)}×`;
  const roiProj = `${report.roiProjected.toFixed(1)}×`;
  const sessions = report.contextWindowsReclaimed.toFixed(1);
  const daysLeft = Math.round(report.daysLeft);

  const headline = report.paidForItself
    ? `Pro ${price}/mo → saved ${saved} this month (est.) = ${roiSo} · on pace for ${roiProj} by month end · +${sessions} sessions' worth of context`
    : `ROI ${roiSo} so far — hasn't paid for itself yet · on pace for ${roiProj} by month end · ${daysLeft} days left`;
  input.stdout(headline);
  input.stdout("");
  input.stdout(`price          ${price}/mo`);
  input.stdout(`saved so far   ${saved} (${report.savedSoFar.tokens} tokens)`);
  input.stdout(`roi so far     ${roiSo}`);
  input.stdout(`projected end  ${proj} (est.) = ${roiProj}`);
  input.stdout(`sessions       +${sessions} sessions' worth of context`);
  input.stdout(`days left      ${daysLeft}`);
  return 0;
}

export const roiCommand = defineCommand({
  meta: {
    name: "roi",
    description: "Is Pro worth its price? Monthly savings vs subscription (Mega Saver Pro).",
  },
  args: {
    price: {
      type: "string",
      description: "Monthly price to compare against: <n> or $<n> (default: $7.99).",
    },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runRoi({
      storeRoot: resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      now: () => Date.now(),
      readAllEvents: defaultSavingsEventReader(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ),
      ...(typeof args.price === "string" ? { price: args.price } : {}),
      json: !!args.json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/roi.test.ts`
Expected: PASS (9 tests: 1 gating + 3 bad-price + 5 render).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/roi.ts apps/cli/test/commands/roi.test.ts
git commit -m "feat(cli): mega roi — savings vs Pro price (gated)"
```

---

### Task 3: register the command + README + changeset

**Files:**
- Modify: `apps/cli/src/main.ts:24` (imports) and `apps/cli/src/main.ts:62` (subCommands)
- Modify: `README.md` (~line 522 command table; ~line 670 Pro section)
- Create: `.changeset/pro-roi.md`

- [ ] **Step 1: Register `roi` in `main.ts`**

Next to the existing savings import (line 24):

```ts
import { roiCommand } from "./commands/roi.js";
```

In the `subCommands` object (line 62 area, alphabetical placement next to `savings`):

```ts
    roi: roiCommand,
```

- [ ] **Step 2: Verify registration via help output**

Run: `pnpm --filter @megasaver/cli build && node apps/cli/dist/main.js --help | grep roi`
Expected: a `roi` line with the description "Is Pro worth its price? …".
(If the dist entry name differs, use the same invocation the repo's smoke docs use — `pnpm --filter @megasaver/cli exec mega --help` after build.)

- [ ] **Step 3: README — command table row**

In the command table (~line 522), after the `mega savings` row:

```md
| `mega roi` | monthly savings vs Pro price — ROI multiple (Pro) |
```

- [ ] **Step 4: README — Pro section**

In the Pro code block (after the `mega savings forecast --goal $15` line, ~line 671):

```sh
mega roi                          # is Pro worth its price? (Pro)
mega roi --price $5               # compare against a custom price
```

After the forecast bullet (~line 677):

```md
- `mega roi [--price $7.99]` — the month's measured savings divided by your Pro
  price: "saved $49 this month (est.) = 6.2×", plus an on-pace month-end
  projection. Honest when it hasn't paid for itself yet.
```

- [ ] **Step 5: Changeset**

Create `.changeset/pro-roi.md`:

```md
---
"@megasaver/cli": minor
---

`mega roi` — Pro module 4: the month's measured savings divided by the Pro
price, as an honest ROI multiple (saved-so-far + on-pace projection).
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/main.ts README.md .changeset/pro-roi.md
git commit -m "feat(cli): register mega roi + README + changeset"
```

---

### Task 4: verification + smoke evidence

- [ ] **Step 1: Full verify**

Run: `pnpm verify`
Expected: biome + tsc + vitest ALL green. Fix anything red before proceeding
(biome will flag formatting drift in the new files; run `pnpm lint:fix` if so).

- [ ] **Step 2: E2E smoke (capture the terminal session as DoD evidence)**

```bash
STORE=$(mktemp -d)
# 1. Free user → upsell:
node apps/cli/dist/main.js roi --store "$STORE"
# Expected: "ROI reporting is a Mega Saver Pro feature. Activate a key: ..."

# 2. Activate the repo's TEST key flow (mirror the forecast smoke in
#    docs/superpowers/specs/2026-07-06-pro-forecast-design.md §Testing: generate
#    a test keypair + license via the entitlement test helper, or reuse the
#    documented `mega license activate` smoke procedure), then:
node apps/cli/dist/main.js roi --store "$STORE"
# Expected: ROI headline (×, (est.)) or "No savings recorded this month yet."
node apps/cli/dist/main.js roi --store "$STORE" --price $5
# Expected: the multiple shifts.
```

- [ ] **Step 3: Rebase on main, re-verify, then reviewer pass**

Per `docs/conventions/process-discipline.md`: `code-reviewer` + `critic`
(MEDIUM risk, same bar as module 3) in fresh contexts, then
`superpowers:finishing-a-development-branch`.
