# Cost Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega cost [--by project|task|agent|session] [--since] [--json]` — one read-only rollup of spend receipts (proxy metering) and measured savings receipts (TokenSaverEvents) with an explicit UNKNOWN bucket for everything unattributable.

**Architecture:** A pure aggregator (`buildCostLedger`) lands in `@megasaver/stats` and is re-exported through `@megasaver/core` (§3c: apps/cli never imports stats directly). The CLI adds collectors that read `proxy-usage/usage.jsonl` via `readProxyUsage`, walk the two `stats/` layouts with the mandatory 16-hex/UUID discriminator, and join registry `agentId` + (soft-dep) mesh presence task labels. A citty command renders the table; an opt-in mtime+size-fingerprint cache is the feature's only write.

**Tech Stack:** TypeScript strict ESM, Zod (boundaries), Citty (CLI), Vitest, `node:fs`/`node:path` only — no new dependencies.

## Global Constraints

- Receipts only: every reported number is a sum over rows on disk; no extrapolation, no projections, no "you saved $X".
- Savings count only rows with a measured before/after pair (`deltaTokens` present, `deltaTokensOf` semantics); pair-less rows go to `unmeasuredSavingsRows`, never converted via bytes/4.
- `UNKNOWN_COST_BUCKET = "UNKNOWN"`: unattributable receipts land there explicitly, rendered last — attribution is never guessed.
- Tokens, not dollars: no USD figure anywhere in v1 (no billed cost exists in the store; `MODEL_LIST_PRICES` prices input tokens only).
- `TaskKickoffEvent` rows are excluded: a kickoff cost row proves only a successful local stdout callback, not model consumption (task-kickoff safety amendment §1/§3).
- Read-only: the single permitted write is the opt-in cache `<store>/cost-ledger/cache.json` (atomic tmp+rename, mtime+size fingerprint, best-effort — any failure means silent recompute).
- Every `stats/` walk discriminates overlay dirs (16-hex, `workspaceKeySchema`) from registry dirs (UUID); all other entries are skipped, never read (stats wiki hard rule).
- Windows-safe: paths via `node:path` `join` only, tolerant reads (ENOENT → empty), cache rename failures swallowed; no timing-tight tests (structural guards only).
- The CLI imports the new stats symbols only via `@megasaver/core` re-exports (§3c dependency invariant, enforced by `apps/cli/test/dependency-graph.test.ts`).
- §8 conventions: strict TS, Zod at boundaries, files ≤ 300 LOC, comments only for non-obvious WHY.

---

### Task 1: Pure `buildCostLedger` aggregator in `@megasaver/stats`

**Files:**
- `packages/stats/src/cost-ledger.ts` (new)
- `packages/stats/test/cost-ledger.test.ts` (new)
- `packages/stats/src/index.ts` (edit — export block)

**Interfaces:**

```ts
export const costFacetSchema: z.ZodEnum<["project", "task", "agent", "session"]>;
export type CostFacet = z.infer<typeof costFacetSchema>;
export const UNKNOWN_COST_BUCKET = "UNKNOWN";

export interface SpendReceipt {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  workspaceKey?: string | undefined;
}

export interface SavingsReceipt {
  createdAt: string;
  project?: string | undefined; // workspaceKey (overlay) or projectId (registry)
  session?: string | undefined; // liveSessionId (overlay) or sessionId (registry)
  deltaTokens?: number | undefined; // present iff the writer measured the pair
}

export interface CostSessionMeta {
  agent?: string | undefined;
  task?: string | undefined;
}

export interface CostLedgerGroup {
  key: string;
  spendReceipts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  measuredSavedTokens: number;
  measuredSavingsReceipts: number;
  unmeasuredSavingsRows: number;
}
export type CostLedgerTotals = Omit<CostLedgerGroup, "key">;

export interface CostLedger {
  facet: CostFacet;
  sinceMs: number | undefined;
  groups: readonly CostLedgerGroup[]; // named groups by spend desc, UNKNOWN last
  totals: CostLedgerTotals;
  skippedUsageLines: number;
}

export interface BuildCostLedgerInput {
  facet: CostFacet;
  sinceMs?: number | undefined;
  usage: readonly SpendReceipt[];
  savings: readonly SavingsReceipt[];
  sessionMeta: ReadonlyMap<string, CostSessionMeta>;
  skippedUsageLines: number;
}

export function buildCostLedger(input: BuildCostLedgerInput): CostLedger;
```

**Steps:**

- [ ] Write the failing test `packages/stats/test/cost-ledger.test.ts` (style mirrors `packages/stats/test/proxy-usage-savings.test.ts` — pure fn, fixture factories):

```ts
import { describe, expect, it } from "vitest";
import {
  type SavingsReceipt,
  type SpendReceipt,
  UNKNOWN_COST_BUCKET,
  buildCostLedger,
  costFacetSchema,
} from "../src/cost-ledger.js";

const spend = (o: Partial<SpendReceipt> = {}): SpendReceipt => ({
  ts: "2026-08-06T10:00:00.000Z",
  model: "claude-sonnet-5",
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 1000,
  cacheCreationTokens: 200,
  ...o,
});

const saving = (o: Partial<SavingsReceipt> = {}): SavingsReceipt => ({
  createdAt: "2026-08-06T10:00:00.000Z",
  ...o,
});

const build = (o: Partial<Parameters<typeof buildCostLedger>[0]> = {}) =>
  buildCostLedger({
    facet: "project",
    usage: [],
    savings: [],
    sessionMeta: new Map(),
    skippedUsageLines: 0,
    ...o,
  });

describe("buildCostLedger", () => {
  it("exposes exactly the four facets", () => {
    expect(costFacetSchema.options).toEqual(["project", "task", "agent", "session"]);
  });

  it("returns no groups and zero totals for empty inputs", () => {
    const ledger = build();
    expect(ledger.groups).toEqual([]);
    expect(ledger.totals.spendReceipts).toBe(0);
    expect(ledger.totals.measuredSavedTokens).toBe(0);
  });

  it("project facet: stamped usage keys by workspaceKey, unstamped goes UNKNOWN", () => {
    const ledger = build({
      usage: [spend({ workspaceKey: "00000000000000aa" }), spend()],
    });
    expect(ledger.groups.map((g) => g.key)).toEqual([
      "00000000000000aa",
      UNKNOWN_COST_BUCKET,
    ]);
    expect(ledger.totals.spendReceipts).toBe(2);
    expect(ledger.totals.inputTokens).toBe(200);
  });

  it("session/agent/task facets: usage rows always land in UNKNOWN (no signal on the row)", () => {
    for (const facet of ["session", "agent", "task"] as const) {
      const ledger = build({ facet, usage: [spend({ workspaceKey: "00000000000000aa" })] });
      expect(ledger.groups).toHaveLength(1);
      expect(ledger.groups[0]?.key).toBe(UNKNOWN_COST_BUCKET);
    }
  });

  it("savings: measured pair adds tokens; pair-less rows are counted, never converted", () => {
    const ledger = build({
      savings: [
        saving({ project: "00000000000000aa", deltaTokens: 500 }),
        saving({ project: "00000000000000aa" }),
      ],
    });
    const group = ledger.groups[0];
    expect(group?.key).toBe("00000000000000aa");
    expect(group?.measuredSavedTokens).toBe(500);
    expect(group?.measuredSavingsReceipts).toBe(1);
    expect(group?.unmeasuredSavingsRows).toBe(1);
  });

  it("agent and task facets key savings through sessionMeta; missing meta goes UNKNOWN", () => {
    const meta = new Map([["sess-1", { agent: "claude-code", task: "cost ledger" }]]);
    const rows = [
      saving({ session: "sess-1", deltaTokens: 10 }),
      saving({ session: "sess-2", deltaTokens: 20 }),
    ];
    const byAgent = build({ facet: "agent", savings: rows, sessionMeta: meta });
    expect(byAgent.groups.map((g) => g.key)).toEqual(["claude-code", UNKNOWN_COST_BUCKET]);
    const byTask = build({ facet: "task", savings: rows, sessionMeta: meta });
    expect(byTask.groups.map((g) => g.key)).toEqual(["cost ledger", UNKNOWN_COST_BUCKET]);
  });

  it("sinceMs windows both sides", () => {
    const ledger = build({
      sinceMs: Date.parse("2026-08-06T00:00:00.000Z"),
      usage: [spend(), spend({ ts: "2026-08-01T00:00:00.000Z" })],
      savings: [
        saving({ project: "p", deltaTokens: 5 }),
        saving({ project: "p", deltaTokens: 7, createdAt: "2026-08-01T00:00:00.000Z" }),
      ],
    });
    expect(ledger.totals.spendReceipts).toBe(1);
    expect(ledger.totals.measuredSavedTokens).toBe(5);
  });

  it("orders named groups by spend tokens desc and pins UNKNOWN last even when largest", () => {
    const ledger = build({
      usage: [
        spend({ inputTokens: 1_000_000 }), // unstamped -> UNKNOWN, biggest spender
        spend({ workspaceKey: "00000000000000aa", inputTokens: 10 }),
        spend({ workspaceKey: "00000000000000bb", inputTokens: 99 }),
      ],
    });
    expect(ledger.groups.map((g) => g.key)).toEqual([
      "00000000000000bb",
      "00000000000000aa",
      UNKNOWN_COST_BUCKET,
    ]);
  });

  it("passes skippedUsageLines through untouched", () => {
    expect(build({ skippedUsageLines: 3 }).skippedUsageLines).toBe(3);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/cost-ledger.test.ts` — expect FAIL: module resolution error for `../src/cost-ledger.js` (file does not exist yet).
- [ ] Implement `packages/stats/src/cost-ledger.ts`:

```ts
import { z } from "zod";

export const costFacetSchema = z.enum(["project", "task", "agent", "session"]);
export type CostFacet = z.infer<typeof costFacetSchema>;

// Attribution is never guessed: a receipt whose row carries no signal for the
// requested facet lands here, and the renderer prints the bucket explicitly.
export const UNKNOWN_COST_BUCKET = "UNKNOWN";

export interface SpendReceipt {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  workspaceKey?: string | undefined;
}

export interface SavingsReceipt {
  createdAt: string;
  project?: string | undefined;
  session?: string | undefined;
  // Present iff the writer measured a real before/after token pair
  // (deltaTokensOf semantics — never a bytes/4 reconstruction).
  deltaTokens?: number | undefined;
}

export interface CostSessionMeta {
  agent?: string | undefined;
  task?: string | undefined;
}

export interface CostLedgerGroup {
  key: string;
  spendReceipts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  measuredSavedTokens: number;
  measuredSavingsReceipts: number;
  unmeasuredSavingsRows: number;
}

export type CostLedgerTotals = Omit<CostLedgerGroup, "key">;

export interface CostLedger {
  facet: CostFacet;
  sinceMs: number | undefined;
  groups: readonly CostLedgerGroup[];
  totals: CostLedgerTotals;
  skippedUsageLines: number;
}

export interface BuildCostLedgerInput {
  facet: CostFacet;
  sinceMs?: number | undefined;
  usage: readonly SpendReceipt[];
  savings: readonly SavingsReceipt[];
  sessionMeta: ReadonlyMap<string, CostSessionMeta>;
  skippedUsageLines: number;
}

function emptyGroup(key: string): CostLedgerGroup {
  return {
    key,
    spendReceipts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    measuredSavedTokens: 0,
    measuredSavingsReceipts: 0,
    unmeasuredSavingsRows: 0,
  };
}

function inWindow(iso: string, sinceMs: number | undefined): boolean {
  if (sinceMs === undefined) return true;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= sinceMs;
}

// Usage rows carry no session/agent/task signal; workspaceKey is the only
// attribution a row can carry today (F33, llm-proxy usage-event.ts) and it
// only serves --by project.
function spendKey(facet: CostFacet, receipt: SpendReceipt): string {
  if (facet === "project" && receipt.workspaceKey !== undefined) {
    return receipt.workspaceKey;
  }
  return UNKNOWN_COST_BUCKET;
}

function savingsKey(
  facet: CostFacet,
  receipt: SavingsReceipt,
  meta: ReadonlyMap<string, CostSessionMeta>,
): string {
  if (facet === "project") return receipt.project ?? UNKNOWN_COST_BUCKET;
  if (facet === "session") return receipt.session ?? UNKNOWN_COST_BUCKET;
  const m = receipt.session === undefined ? undefined : meta.get(receipt.session);
  const value = facet === "agent" ? m?.agent : m?.task;
  return value ?? UNKNOWN_COST_BUCKET;
}

const spendTokens = (g: CostLedgerGroup): number =>
  g.inputTokens + g.outputTokens + g.cacheReadTokens + g.cacheCreationTokens;

export function buildCostLedger(input: BuildCostLedgerInput): CostLedger {
  const groups = new Map<string, CostLedgerGroup>();
  const group = (key: string): CostLedgerGroup => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created = emptyGroup(key);
    groups.set(key, created);
    return created;
  };

  for (const receipt of input.usage) {
    if (!inWindow(receipt.ts, input.sinceMs)) continue;
    const g = group(spendKey(input.facet, receipt));
    g.spendReceipts += 1;
    g.inputTokens += receipt.inputTokens;
    g.outputTokens += receipt.outputTokens;
    g.cacheReadTokens += receipt.cacheReadTokens;
    g.cacheCreationTokens += receipt.cacheCreationTokens;
  }

  for (const receipt of input.savings) {
    if (!inWindow(receipt.createdAt, input.sinceMs)) continue;
    const g = group(savingsKey(input.facet, receipt, input.sessionMeta));
    if (receipt.deltaTokens === undefined) {
      g.unmeasuredSavingsRows += 1;
    } else {
      g.measuredSavedTokens += receipt.deltaTokens;
      g.measuredSavingsReceipts += 1;
    }
  }

  const named = [...groups.values()].filter((g) => g.key !== UNKNOWN_COST_BUCKET);
  named.sort(
    (a, b) =>
      spendTokens(b) - spendTokens(a) ||
      b.measuredSavedTokens - a.measuredSavedTokens ||
      a.key.localeCompare(b.key),
  );
  const unknown = groups.get(UNKNOWN_COST_BUCKET);
  const ordered = unknown ? [...named, unknown] : named;

  const totals: CostLedgerTotals = {
    spendReceipts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    measuredSavedTokens: 0,
    measuredSavingsReceipts: 0,
    unmeasuredSavingsRows: 0,
  };
  for (const g of ordered) {
    totals.spendReceipts += g.spendReceipts;
    totals.inputTokens += g.inputTokens;
    totals.outputTokens += g.outputTokens;
    totals.cacheReadTokens += g.cacheReadTokens;
    totals.cacheCreationTokens += g.cacheCreationTokens;
    totals.measuredSavedTokens += g.measuredSavedTokens;
    totals.measuredSavingsReceipts += g.measuredSavingsReceipts;
    totals.unmeasuredSavingsRows += g.unmeasuredSavingsRows;
  }

  return {
    facet: input.facet,
    sinceMs: input.sinceMs,
    groups: ordered,
    totals,
    skippedUsageLines: input.skippedUsageLines,
  };
}
```

- [ ] Add the export block to `packages/stats/src/index.ts` (after the `net-effect.js` block):

```ts
export {
  UNKNOWN_COST_BUCKET,
  buildCostLedger,
  costFacetSchema,
  type BuildCostLedgerInput,
  type CostFacet,
  type CostLedger,
  type CostLedgerGroup,
  type CostLedgerTotals,
  type CostSessionMeta,
  type SavingsReceipt,
  type SpendReceipt,
} from "./cost-ledger.js";
```

- [ ] Run `pnpm --filter @megasaver/stats exec vitest run test/cost-ledger.test.ts` — expect PASS (9 tests).
- [ ] Run `pnpm --filter @megasaver/stats typecheck && pnpm exec biome check packages/stats/src/cost-ledger.ts packages/stats/test/cost-ledger.test.ts` — expect clean.
- [ ] Commit: `feat(stats): add pure cost-ledger rollup`

---

### Task 2: Re-export the cost-ledger surface through `@megasaver/core`

**Files:**
- `packages/core/src/context-gate.ts` (edit — stats re-export blocks live here; see the existing `proxyUsageSavings` block)
- `packages/core/test/cost-ledger-reexport.test.ts` (new — mirrors `packages/core/test/audit-reexport.test.ts`)

**Interfaces:** re-exports only; identical to Task 1 signatures.

**Steps:**

- [ ] Write the failing test `packages/core/test/cost-ledger-reexport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { UNKNOWN_COST_BUCKET, buildCostLedger, costFacetSchema } from "../src/index.js";

describe("core re-exports the cost-ledger surface", () => {
  it("exposes the pure builder, facet schema, and bucket constant", () => {
    expect(typeof buildCostLedger).toBe("function");
    expect(costFacetSchema.options).toEqual(["project", "task", "agent", "session"]);
    expect(UNKNOWN_COST_BUCKET).toBe("UNKNOWN");
    const ledger = buildCostLedger({
      facet: "project",
      usage: [],
      savings: [],
      sessionMeta: new Map(),
      skippedUsageLines: 0,
    });
    expect(ledger.groups).toEqual([]);
    expect(ledger.totals.spendReceipts).toBe(0);
  });
});
```

- [ ] Run `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core exec vitest run test/cost-ledger-reexport.test.ts` — expect FAIL: `buildCostLedger` is not exported from `../src/index.js`. (The stats build first so the workspace dep resolves the new symbols.)
- [ ] Add to `packages/core/src/context-gate.ts`, after the existing budget re-export block:

```ts
// C4 cost ledger: the CLI consumes the pure rollup only through core (§3c —
// apps/cli never depends on @megasaver/stats directly).
export {
  UNKNOWN_COST_BUCKET,
  buildCostLedger,
  costFacetSchema,
  type BuildCostLedgerInput,
  type CostFacet,
  type CostLedger,
  type CostLedgerGroup,
  type CostLedgerTotals,
  type CostSessionMeta,
  type SavingsReceipt,
  type SpendReceipt,
} from "@megasaver/stats";
```

- [ ] Run `pnpm --filter @megasaver/core exec vitest run test/cost-ledger-reexport.test.ts` — expect PASS (1 test).
- [ ] Run `pnpm --filter @megasaver/core typecheck && pnpm exec biome check packages/core/src/context-gate.ts packages/core/test/cost-ledger-reexport.test.ts` — expect clean.
- [ ] Commit: `feat(core): re-export cost-ledger surface`

---

### Task 3: CLI collectors — savings walk, session metadata, `--since` parsing

**Files:**
- `apps/cli/src/commands/cost/collect.ts` (new)
- `apps/cli/test/cost/collect.test.ts` (new — fixture store dirs like `apps/cli/test/audit/session-overlay.test.ts`)

**Interfaces:**

```ts
export interface SavingsEventFile {
  dir: string; // workspaceKey (16-hex) or projectId (UUID)
  file: string; // <uuid>.events.jsonl
}
export function listSavingsEventFiles(storeRoot: string): SavingsEventFile[];
export function collectSavingsReceipts(storeRoot: string): SavingsReceipt[];
export function collectSessionMeta(storeRoot: string): Map<string, CostSessionMeta>;
export function toSpendReceipts(events: readonly ProxyUsageEvent[]): SpendReceipt[];
export function parseSince(raw: string, nowMs: number): number | undefined;
```

Facts this task relies on (verified against source):

- Overlay layout `stats/<workspaceKey>/<liveSessionId>.events.jsonl`, registry layout `stats/<projectId>/<sessionId>.events.jsonl` (`packages/stats/src/store.ts:37,213`).
- Sibling non-session ledgers share those dirs and MUST be excluded: `guard.events.jsonl` (`packages/stats/src/guard-event.ts:50`), `handoff.events.jsonl`, `warm-start.events.jsonl`, `code-truth.events.jsonl`. ASSUMPTION: live session ids are transcript UUIDs (`packages/stats/src/event.ts:70` comment "liveSessionId the transcript uuid"; UUID fixtures in `apps/cli/test/audit/session-overlay.test.ts`), so a UUID filename filter excludes every sibling ledger structurally; a hypothetical non-UUID live id would be skipped (safe direction: under-attribute, never mis-attribute).
- Registry API: `createJsonDirectoryCoreRegistry({ rootDir })` → `listProjects(): Project[]`, `listSessions(projectId): Session[]`; `Session.agentId` (`packages/core/src/registry.ts:71-74`, `packages/core/src/session.ts:14`).
- Mesh presence contract (LOCKED by the session-mesh pair, build-order 1): presence files at `<store>/mesh/presence/<liveSessionId>.json` carry a `PresenceRecord` `{ liveSessionId, workspaceKey, agent, cwd, branch?, taskLabel?, status, registeredAt, lastSeenAt }` (`docs/superpowers/plans/2026-08-06-session-mesh.md:139-151`; the mesh writer schema is `.strict()` — the ledger reader is deliberately non-strict). The reader parses only `{ liveSessionId, agent, taskLabel }`, keys the meta map by `liveSessionId` (filename fallback stays valid: the basename IS the live session id), and degrades to an empty contribution when the dir is absent or unreadable. Join-key caveat: registry session ids and transcript live session ids are distinct id spaces — a registry row gains a task label only when its session id equals the live session id; otherwise registry rows carry no task attribution (safe direction: degrade to UNKNOWN, never mis-attribute).

**Steps:**

- [ ] Write the failing test `apps/cli/test/cost/collect.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectSavingsReceipts,
  collectSessionMeta,
  parseSince,
  toSpendReceipts,
} from "../../src/commands/cost/collect.js";

// Real layout keys (stats wiki rule): overlay dirs are 16-hex workspaceKeys,
// registry dirs are project UUIDs. Fixture keys must be real-shaped.
const WORKSPACE = "00000000000000aa";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OVERLAY_SESSION = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const REGISTRY_SESSION = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-06T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cost-collect-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeEvents(dir: string, file: string, lines: readonly unknown[]): void {
  mkdirSync(join(root, "stats", dir), { recursive: true });
  writeFileSync(
    join(root, "stats", dir, file),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

describe("collectSavingsReceipts", () => {
  it("collects overlay and registry rows with project/session attribution", () => {
    writeEvents(WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`, [
      { createdAt: TS, deltaTokens: 120, rawTokens: 150, returnedTokens: 30 },
    ]);
    writeEvents(PROJECT, `${REGISTRY_SESSION}.events.jsonl`, [{ createdAt: TS }]);
    const receipts = collectSavingsReceipts(root);
    expect(receipts).toHaveLength(2);
    const overlay = receipts.find((r) => r.project === WORKSPACE);
    expect(overlay?.session).toBe(OVERLAY_SESSION);
    expect(overlay?.deltaTokens).toBe(120);
    const registry = receipts.find((r) => r.project === PROJECT);
    expect(registry?.session).toBe(REGISTRY_SESSION);
    expect(registry?.deltaTokens).toBeUndefined();
  });

  it("skips non-layout dirs, decoy files, and non-session sibling ledgers", () => {
    writeEvents("task-kickoff-sessions", "x.events.jsonl", [{ createdAt: TS, deltaTokens: 5 }]);
    writeEvents(PROJECT, "guard.events.jsonl", [{ createdAt: TS, deltaTokens: 7 }]);
    writeFileSync(join(root, "stats", "budget.json"), "{}");
    expect(collectSavingsReceipts(root)).toEqual([]);
  });

  it("skips torn lines and returns [] for a missing store", () => {
    mkdirSync(join(root, "stats", WORKSPACE), { recursive: true });
    writeFileSync(join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`), '{"createdAt":');
    expect(collectSavingsReceipts(root)).toEqual([]);
    expect(collectSavingsReceipts(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("collectSessionMeta", () => {
  it("maps registry sessions to agentId; mesh adds task, registry agent wins", async () => {
    await initStore(root);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject({
      id: PROJECT,
      name: "fixture",
      rootPath: root,
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createSession({
      id: REGISTRY_SESSION,
      projectId: PROJECT,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: TS,
      endedAt: null,
    });
    mkdirSync(join(root, "mesh", "presence"), { recursive: true });
    // Authoritative PresenceRecord shape (session-mesh plan, locked). This
    // fixture deliberately makes the live session id equal the registry
    // session id — the only case where a registry row gains a task label.
    writeFileSync(
      join(root, "mesh", "presence", `${REGISTRY_SESSION}.json`),
      JSON.stringify({
        liveSessionId: REGISTRY_SESSION,
        workspaceKey: WORKSPACE,
        agent: "codex",
        cwd: root,
        taskLabel: "cost ledger",
        status: "working",
        registeredAt: TS,
        lastSeenAt: TS,
      }),
    );
    // A live-only presence record (no registry session) keys by liveSessionId.
    writeFileSync(
      join(root, "mesh", "presence", `${OVERLAY_SESSION}.json`),
      JSON.stringify({
        liveSessionId: OVERLAY_SESSION,
        workspaceKey: WORKSPACE,
        agent: "codex",
        cwd: root,
        taskLabel: "warm start",
        status: "idle",
        registeredAt: TS,
        lastSeenAt: TS,
      }),
    );
    const meta = collectSessionMeta(root);
    expect(meta.get(REGISTRY_SESSION)).toEqual({ agent: "claude-code", task: "cost ledger" });
    expect(meta.get(OVERLAY_SESSION)).toEqual({ agent: "codex", task: "warm start" });
  });

  it("degrades to an empty map on an uninitialized store (no mesh, no registry)", () => {
    expect(collectSessionMeta(root).size).toBe(0);
  });
});

describe("toSpendReceipts / parseSince", () => {
  it("carries the four counters and only stamps workspaceKey when present", () => {
    const receipts = toSpendReceipts([
      {
        id: "00000000-0000-4000-8000-000000000000",
        ts: TS,
        model: "claude-sonnet-5",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        messageCount: 1,
        stream: false,
      },
    ]);
    expect(receipts[0]).toEqual({
      ts: TS,
      model: "claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    });
  });

  it("parses ISO datetimes and relative windows; rejects garbage", () => {
    const NOW = Date.parse("2026-08-06T12:00:00.000Z");
    expect(parseSince("2026-08-01T00:00:00.000Z", NOW)).toBe(
      Date.parse("2026-08-01T00:00:00.000Z"),
    );
    expect(parseSince("7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(parseSince("6h", NOW)).toBe(NOW - 6 * 3_600_000);
    expect(parseSince("next tuesday", NOW)).toBeUndefined();
  });
});
```

- [ ] Run `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli exec vitest run test/cost/collect.test.ts` — expect FAIL: module resolution error for `../../src/commands/cost/collect.js`.
- [ ] Implement `apps/cli/src/commands/cost/collect.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type CostSessionMeta,
  type SavingsReceipt,
  type SpendReceipt,
  createJsonDirectoryCoreRegistry,
} from "@megasaver/core";
import type { ProxyUsageEvent } from "@megasaver/llm-proxy";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";

const EVENTS_SUFFIX = ".events.jsonl";
const uuidSchema = z.string().uuid();

// Loose per-line shape (runAuditUsage precedent: resilient to schema drift).
// deltaTokens is trusted as the writer's measured-pair product (deltaTokensOf
// semantics) — never reconstructed from bytes here.
const looseEventSchema = z.object({
  createdAt: z.string(),
  deltaTokens: z.number().int().optional(),
});

export interface SavingsEventFile {
  dir: string;
  file: string;
}

// Walk stats/ under the mandatory two-layout discriminator: overlay dirs are
// 16-hex workspaceKeys, registry dirs are project UUIDs; every other entry
// (budget.json, task-kickoff-sessions, …) is skipped, never read. Session
// event files have UUID basenames, which excludes the sibling ledgers
// (guard/handoff/warm-start/code-truth .events.jsonl) structurally.
export function listSavingsEventFiles(storeRoot: string): SavingsEventFile[] {
  const statsDir = join(storeRoot, "stats");
  let names: string[];
  try {
    names = readdirSync(statsDir);
  } catch {
    return [];
  }
  const found: SavingsEventFile[] = [];
  for (const dir of names) {
    const isOverlay = workspaceKeySchema.safeParse(dir).success;
    const isRegistry = !isOverlay && uuidSchema.safeParse(dir).success;
    if (!isOverlay && !isRegistry) continue;
    let files: string[];
    try {
      files = readdirSync(join(statsDir, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(EVENTS_SUFFIX)) continue;
      const base = file.slice(0, -EVENTS_SUFFIX.length);
      if (!uuidSchema.safeParse(base).success) continue;
      found.push({ dir, file });
    }
  }
  return found;
}

function readEventLines(path: string, project: string, session: string): SavingsReceipt[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const receipts: SavingsReceipt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = looseEventSchema.safeParse(parsed);
    if (!row.success) continue;
    receipts.push({
      createdAt: row.data.createdAt,
      project,
      session,
      ...(row.data.deltaTokens !== undefined ? { deltaTokens: row.data.deltaTokens } : {}),
    });
  }
  return receipts;
}

export function collectSavingsReceipts(storeRoot: string): SavingsReceipt[] {
  const receipts: SavingsReceipt[] = [];
  for (const { dir, file } of listSavingsEventFiles(storeRoot)) {
    const session = file.slice(0, -EVENTS_SUFFIX.length);
    receipts.push(...readEventLines(join(storeRoot, "stats", dir, file), dir, session));
  }
  return receipts;
}

// Locked PresenceRecord contract (session-mesh plan, build-order 1):
// mesh/presence/<liveSessionId>.json carries { liveSessionId, workspaceKey,
// agent, cwd, branch?, taskLabel?, status, registeredAt, lastSeenAt }.
// Parse only the three fields the ledger needs, non-strict, so mesh field
// additions never break this reader. Absent dir -> no task labels.
const meshPresenceSchema = z.object({
  liveSessionId: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
  taskLabel: z.string().min(1).optional(),
});

export function collectSessionMeta(storeRoot: string): Map<string, CostSessionMeta> {
  const meta = new Map<string, CostSessionMeta>();
  try {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });
    for (const project of registry.listProjects()) {
      for (const session of registry.listSessions(project.id)) {
        meta.set(session.id, { agent: session.agentId });
      }
    }
  } catch {
    // Uninitialized store: the agent facet degrades to UNKNOWN.
  }
  const presenceDir = join(storeRoot, "mesh", "presence");
  let files: string[];
  try {
    files = readdirSync(presenceDir);
  } catch {
    return meta;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(presenceDir, file), "utf8"));
    } catch {
      continue;
    }
    const presence = meshPresenceSchema.safeParse(parsed);
    if (!presence.success) continue;
    const sessionId = presence.data.liveSessionId ?? file.slice(0, -".json".length);
    const existing = meta.get(sessionId);
    // Registry agent wins: it is a validated agentIdSchema enum, mesh agent
    // is free-form. Task labels only exist on mesh presence. Registry session
    // ids and transcript live session ids are distinct id spaces: a registry
    // row is enriched only when its id happens to equal the live session id;
    // otherwise it keeps agent-only meta (task facet degrades to UNKNOWN).
    const agent = existing?.agent ?? presence.data.agent;
    meta.set(sessionId, {
      ...(agent !== undefined ? { agent } : {}),
      ...(presence.data.taskLabel !== undefined ? { task: presence.data.taskLabel } : {}),
    });
  }
  return meta;
}

export function toSpendReceipts(events: readonly ProxyUsageEvent[]): SpendReceipt[] {
  return events.map((e) => ({
    ts: e.ts,
    model: e.model,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    cacheReadTokens: e.cacheReadTokens,
    cacheCreationTokens: e.cacheCreationTokens,
    ...(e.workspaceKey !== undefined ? { workspaceKey: e.workspaceKey } : {}),
  }));
}

// ISO 8601 datetime/date, or a relative window: <N>d (days), <N>h (hours).
// Bounded quantifier, anchored — not in the unbounded-run ReDoS class.
export function parseSince(raw: string, nowMs: number): number | undefined {
  const rel = /^(\d{1,4})([dh])$/.exec(raw.trim());
  if (rel?.[1] !== undefined && rel[2] !== undefined) {
    const n = Number.parseInt(rel[1], 10);
    return nowMs - n * (rel[2] === "d" ? 86_400_000 : 3_600_000);
  }
  const abs = Date.parse(raw);
  return Number.isFinite(abs) ? abs : undefined;
}
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/cost/collect.test.ts` — expect PASS (7 tests).
- [ ] Run `pnpm --filter @megasaver/cli typecheck && pnpm exec biome check apps/cli/src/commands/cost apps/cli/test/cost` — expect clean.
- [ ] Commit: `feat(cli): add cost receipt collectors`

---

### Task 4: Optional mtime+size-fingerprint savings cache

**Files:**
- `apps/cli/src/commands/cost/cache.ts` (new)
- `apps/cli/test/cost/cache.test.ts` (new)

**Interfaces:**

```ts
export type CostCacheFingerprint = { path: string; size: number; mtimeMs: number }[];
export function costCachePath(storeRoot: string): string; // <store>/cost-ledger/cache.json
export function savingsFingerprint(storeRoot: string): CostCacheFingerprint;
export function readCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
): SavingsReceipt[] | undefined;
export function writeCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
  savings: readonly SavingsReceipt[],
): void; // best-effort; never throws
```

**Steps:**

- [ ] Write the failing test `apps/cli/test/cost/cache.test.ts`:

```ts
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  costCachePath,
  readCostCache,
  savingsFingerprint,
  writeCostCache,
} from "../../src/commands/cost/cache.js";
import { collectSavingsReceipts } from "../../src/commands/cost/collect.js";

const WORKSPACE = "00000000000000aa";
const OVERLAY_SESSION = "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6";
const TS = "2026-08-06T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cost-cache-"));
  mkdirSync(join(root, "stats", WORKSPACE), { recursive: true });
  writeFileSync(
    join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`),
    `${JSON.stringify({ createdAt: TS, deltaTokens: 42 })}\n`,
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cost savings cache", () => {
  it("round-trips receipts when the fingerprint matches", () => {
    const fingerprint = savingsFingerprint(root);
    const savings = collectSavingsReceipts(root);
    writeCostCache(root, fingerprint, savings);
    expect(readCostCache(root, fingerprint)).toEqual(savings);
  });

  it("misses after a source file changes (size drives this — no wall-clock reliance)", () => {
    const before = savingsFingerprint(root);
    writeCostCache(root, before, collectSavingsReceipts(root));
    appendFileSync(
      join(root, "stats", WORKSPACE, `${OVERLAY_SESSION}.events.jsonl`),
      `${JSON.stringify({ createdAt: TS, deltaTokens: 7 })}\n`,
    );
    expect(readCostCache(root, savingsFingerprint(root))).toBeUndefined();
  });

  it("misses on a corrupt or absent cache file", () => {
    const fingerprint = savingsFingerprint(root);
    expect(readCostCache(root, fingerprint)).toBeUndefined();
    mkdirSync(join(root, "cost-ledger"), { recursive: true });
    writeFileSync(costCachePath(root), "not json");
    expect(readCostCache(root, fingerprint)).toBeUndefined();
  });

  it("swallows write failures (cache is best-effort, never fatal)", () => {
    rmSync(root, { recursive: true, force: true });
    // Parent gone: mkdir/write will fail; the ledger must not care.
    expect(() => writeCostCache("/nonexistent-root/nested", [], [])).not.toThrow();
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/cost/cache.test.ts` — expect FAIL: module resolution error for `../../src/commands/cost/cache.js`.
- [ ] Implement `apps/cli/src/commands/cost/cache.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SavingsReceipt } from "@megasaver/core";
import { z } from "zod";
import { listSavingsEventFiles } from "./collect.js";

const fingerprintEntrySchema = z.object({
  path: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
});

const cacheFileSchema = z.object({
  version: z.literal(1),
  fingerprint: z.array(fingerprintEntrySchema),
  savings: z.array(
    z.object({
      createdAt: z.string(),
      project: z.string().optional(),
      session: z.string().optional(),
      deltaTokens: z.number().int().optional(),
    }),
  ),
});

export type CostCacheFingerprint = z.infer<typeof fingerprintEntrySchema>[];

export function costCachePath(storeRoot: string): string {
  return join(storeRoot, "cost-ledger", "cache.json");
}

// Fingerprint = every session .events.jsonl the savings walk would read,
// sorted, with size + mtimeMs. Added/removed/changed files all change it, so
// the cache can never serve stale receipts. `path` is a portable cache KEY
// (forward slashes on purpose), never used to open a file.
export function savingsFingerprint(storeRoot: string): CostCacheFingerprint {
  const entries: CostCacheFingerprint = [];
  for (const { dir, file } of listSavingsEventFiles(storeRoot)) {
    try {
      const s = statSync(join(storeRoot, "stats", dir, file));
      entries.push({ path: `${dir}/${file}`, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Raced deletion: absence changes the fingerprint by omission.
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export function readCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
): SavingsReceipt[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(costCachePath(storeRoot), "utf8"));
  } catch {
    return undefined;
  }
  const cache = cacheFileSchema.safeParse(parsed);
  if (!cache.success) return undefined;
  if (JSON.stringify(cache.data.fingerprint) !== JSON.stringify(fingerprint)) {
    return undefined;
  }
  return cache.data.savings;
}

// Best-effort, atomic (tmp + rename). Any failure — including a Windows EPERM
// rename over an open handle (seen-ledger lesson) — leaves no cache; the next
// run silently recomputes.
export function writeCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
  savings: readonly SavingsReceipt[],
): void {
  const path = costCachePath(storeRoot);
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(join(storeRoot, "cost-ledger"), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify({ version: 1, fingerprint, savings }), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/cost/cache.test.ts` — expect PASS (4 tests).
- [ ] Run `pnpm --filter @megasaver/cli typecheck && pnpm exec biome check apps/cli/src/commands/cost apps/cli/test/cost` — expect clean.
- [ ] Commit: `feat(cli): add optional cost savings cache`

---

### Task 5: `mega cost` command — runCost, renderer, registration

**Files:**
- `apps/cli/src/commands/cost/index.ts` (new)
- `apps/cli/src/main.ts` (edit — register `cost` in the root `subCommands` map, `apps/cli/src/main.ts:60`)
- `apps/cli/test/cost/cost.test.ts` (new — injectable readers like `apps/cli/test/audit-usage.test.ts`)

**Interfaces:**

```ts
export type RunCostInput = {
  storeRoot: string;
  by: CostFacet;
  sinceMs?: number | undefined;
  json: boolean;
  cache?: boolean; // default false; --cache opts in
  readUsage?: typeof readProxyUsage;
  readSavings?: (storeRoot: string) => SavingsReceipt[];
  readMeta?: (storeRoot: string) => Map<string, CostSessionMeta>;
};
export async function runCost(input: RunCostInput): Promise<string>;
export function renderCostTable(ledger: CostLedger): string;
export const costCommand: ReturnType<typeof defineCommand>;
```

Facts this task relies on (verified against source):

- `readProxyUsage({ storeRoot })` → `{ events, skippedLines }` and the F32
  torn-line counting: `packages/llm-proxy/src/store.ts:43-65`.
- `readStoreEnv(storeFlag)` / `resolveStorePath(env)` and the empty-string
  fallback on resolve failure: `apps/cli/src/store.ts` (same handler shape as
  `auditUsageCommand`, `apps/cli/src/commands/audit/usage.ts:242-266`).
- Root command registration map: `apps/cli/src/main.ts:60`.

**Steps:**

- [ ] Write the failing test `apps/cli/test/cost/cost.test.ts`:

```ts
import type { ProxyUsageEvent } from "@megasaver/llm-proxy";
import { describe, expect, it } from "vitest";
import { runCost } from "../../src/commands/cost/index.js";

const usage = (o: Partial<ProxyUsageEvent> = {}): ProxyUsageEvent => ({
  id: "00000000-0000-4000-8000-000000000000",
  ts: "2026-08-06T10:00:00.000Z",
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 50,
  cacheReadTokens: 4000,
  cacheCreationTokens: 300,
  messageCount: 1,
  stream: false,
  ...o,
});

const base = {
  storeRoot: "/tmp/megasaver-cost-not-read",
  by: "project" as const,
  json: false,
  readUsage: async () => ({ events: [] as ProxyUsageEvent[], skippedLines: 0 }),
  readSavings: () => [],
  readMeta: () => new Map(),
};

describe("mega cost", () => {
  it("reports the onboarding hint when no receipts exist", async () => {
    const out = await runCost({ ...base });
    expect(out).toContain("No receipts recorded yet");
    expect(out).toContain("mega proxy start");
  });

  it("renders stamped and UNKNOWN spend groups with totals", async () => {
    const out = await runCost({
      ...base,
      readUsage: async () => ({
        events: [usage({ workspaceKey: "00000000000000aa" }), usage()],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("00000000000000aa");
    expect(out).toContain("UNKNOWN");
    expect(out).toContain("receipts: 2 (2 spend, 0 measured savings, 0 unmeasured savings rows)");
    expect(out).toContain("tokens, not dollars");
  });

  it("session facet: unstamped spend lands entirely in UNKNOWN", async () => {
    const out = await runCost({
      ...base,
      by: "session",
      readUsage: async () => ({
        events: [usage({ workspaceKey: "00000000000000aa" })],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("UNKNOWN");
    expect(out).not.toContain("00000000000000aa");
  });

  it("shows measured savings only; unmeasured rows are counted, never converted", async () => {
    const out = await runCost({
      ...base,
      readSavings: () => [
        {
          createdAt: "2026-08-06T10:00:00.000Z",
          project: "00000000000000aa",
          session: "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6",
          deltaTokens: 500,
        },
        {
          createdAt: "2026-08-06T10:00:00.000Z",
          project: "00000000000000aa",
          session: "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6",
        },
      ],
    });
    expect(out).toContain("500");
    // Per-group unmeasured column (spec Goal: per-group measured/unmeasured
    // savings receipt counts), plus the overall total in the summary line.
    expect(out).toMatch(/^group\b.*\bunmeasured$/m);
    expect(out).toContain("1 unmeasured savings rows");
    expect(out).toContain("never converted or extrapolated");
  });

  it("windows receipts with sinceMs", async () => {
    const out = await runCost({
      ...base,
      sinceMs: Date.parse("2026-08-06T00:00:00.000Z"),
      readUsage: async () => ({
        events: [usage(), usage({ ts: "2026-08-01T00:00:00.000Z" })],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("receipts: 1 (1 spend, 0 measured savings, 0 unmeasured savings rows)");
  });

  it("emits machine-readable JSON with UNKNOWN pinned last", async () => {
    const out = await runCost({
      ...base,
      json: true,
      readUsage: async () => ({
        events: [usage(), usage({ workspaceKey: "00000000000000aa" })],
        skippedLines: 2,
      }),
    });
    const parsed = JSON.parse(out);
    expect(parsed.facet).toBe("project");
    expect(parsed.skippedUsageLines).toBe(2);
    expect(parsed.groups.at(-1).key).toBe("UNKNOWN");
    expect(parsed.totals.inputTokens).toBe(2000);
  });

  it("renders the torn-line warning when the usage reader reports skips", async () => {
    const out = await runCost({
      ...base,
      readUsage: async () => ({ events: [usage()], skippedLines: 3 }),
    });
    expect(out).toContain("⚠ 3 unreadable usage lines skipped");
  });
});
```

- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/cost/cost.test.ts` — expect FAIL: module resolution error for `../../src/commands/cost/index.js`.
- [ ] Implement `apps/cli/src/commands/cost/index.ts`:

```ts
import {
  type CostFacet,
  type CostLedger,
  type CostLedgerTotals,
  type CostSessionMeta,
  type SavingsReceipt,
  buildCostLedger,
  costFacetSchema,
} from "@megasaver/core";
import { type ProxyUsageEvent, readProxyUsage } from "@megasaver/llm-proxy";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { readCostCache, savingsFingerprint, writeCostCache } from "./cache.js";
import {
  collectSavingsReceipts,
  collectSessionMeta,
  parseSince,
  toSpendReceipts,
} from "./collect.js";

export type RunCostInput = {
  storeRoot: string;
  by: CostFacet;
  sinceMs?: number | undefined;
  json: boolean;
  cache?: boolean;
  readUsage?: typeof readProxyUsage;
  readSavings?: (storeRoot: string) => SavingsReceipt[];
  readMeta?: (storeRoot: string) => Map<string, CostSessionMeta>;
};

const n = (x: number): string => x.toLocaleString("en-US");
const WIDTHS = [22, 11, 12, 10, 12, 12, 12, 11, 10] as const;

function row(cells: readonly string[]): string {
  return cells
    .map((cell, i) => {
      const w = WIDTHS[i] ?? 12;
      return i === 0 ? cell.padEnd(w) : cell.padStart(w);
    })
    .join("  ")
    .trimEnd();
}

function groupCells(label: string, g: CostLedgerTotals): string[] {
  return [
    label,
    n(g.spendReceipts),
    n(g.inputTokens),
    n(g.outputTokens),
    n(g.cacheReadTokens),
    n(g.cacheCreationTokens),
    g.measuredSavingsReceipts > 0 ? n(g.measuredSavedTokens) : "—",
    n(g.measuredSavingsReceipts),
    n(g.unmeasuredSavingsRows),
  ];
}

export function renderCostTable(ledger: CostLedger): string {
  const t = ledger.totals;
  const receiptsTotal = t.spendReceipts + t.measuredSavingsReceipts + t.unmeasuredSavingsRows;
  const skipNote =
    ledger.skippedUsageLines > 0
      ? ["", `⚠ ${ledger.skippedUsageLines} unreadable usage lines skipped`]
      : [];
  if (receiptsTotal === 0) {
    return [
      "No receipts recorded yet (or none in this window).",
      "Spend receipts come from `mega proxy start` (point your agent at it);",
      "savings receipts come from the saver hook/tools.",
      ...skipNote,
    ].join("\n");
  }
  const lines: string[] = [
    `cost by ${ledger.facet} — receipts only (tokens, not dollars)`,
    "",
    row(["group", "spend-rcpts", "input", "output", "cache-read", "cache-write", "saved", "saved-rcpts", "unmeasured"]),
  ];
  for (const g of ledger.groups) {
    lines.push(row(groupCells(g.key, g)));
  }
  lines.push(row(groupCells("total", t)));
  lines.push(
    "",
    `receipts: ${n(receiptsTotal)} (${n(t.spendReceipts)} spend, ${n(t.measuredSavingsReceipts)} measured savings, ${n(t.unmeasuredSavingsRows)} unmeasured savings rows)`,
    "UNKNOWN: receipts carrying no attribution for this grouping — never guessed.",
    "saved counts only rows with a measured before/after token pair; unmeasured",
    "rows are counted above, never converted or extrapolated.",
    ...skipNote,
  );
  return lines.join("\n");
}

export async function runCost(input: RunCostInput): Promise<string> {
  const readUsage = input.readUsage ?? readProxyUsage;
  const readMeta = input.readMeta ?? collectSessionMeta;

  let usageEvents: readonly ProxyUsageEvent[] = [];
  let skippedUsageLines = 0;
  try {
    const read = await readUsage({ storeRoot: input.storeRoot });
    usageEvents = read.events;
    skippedUsageLines = read.skippedLines;
  } catch {
    // No usage log yet.
  }

  let savings: SavingsReceipt[];
  if (input.readSavings) {
    savings = input.readSavings(input.storeRoot);
  } else if (input.cache === true) {
    const fingerprint = savingsFingerprint(input.storeRoot);
    const cached = readCostCache(input.storeRoot, fingerprint);
    if (cached === undefined) {
      savings = collectSavingsReceipts(input.storeRoot);
      writeCostCache(input.storeRoot, fingerprint, savings);
    } else {
      savings = cached;
    }
  } else {
    savings = collectSavingsReceipts(input.storeRoot);
  }

  const ledger = buildCostLedger({
    facet: input.by,
    sinceMs: input.sinceMs,
    usage: toSpendReceipts(usageEvents),
    savings,
    sessionMeta: readMeta(input.storeRoot),
    skippedUsageLines,
  });

  return input.json ? JSON.stringify(ledger) : renderCostTable(ledger);
}

export const costCommand = defineCommand({
  meta: {
    name: "cost",
    description: "Unified cost ledger: spend + savings receipts by project, task, agent, session.",
  },
  args: {
    by: {
      type: "string",
      default: "project",
      description: "Group by: project | task | agent | session.",
    },
    since: { type: "string", description: "Window start: ISO 8601, or <N>d / <N>h." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
    cache: {
      type: "boolean",
      default: false,
      description: "Use the optional mtime-keyed savings cache.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const facet = costFacetSchema.safeParse(args.by);
    if (!facet.success) {
      process.stderr.write(`invalid --by value: ${String(args.by)} (use project|task|agent|session)\n`);
      process.exitCode = 1;
      return;
    }
    let sinceMs: number | undefined;
    if (typeof args.since === "string") {
      sinceMs = parseSince(args.since, Date.now());
      if (sinceMs === undefined) {
        process.stderr.write(`invalid --since value: ${args.since} (use ISO 8601, <N>d or <N>h)\n`);
        process.exitCode = 1;
        return;
      }
    }
    const storeEnv = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    let storeRoot: string;
    try {
      storeRoot = resolveStorePath(storeEnv);
    } catch {
      storeRoot = "";
    }
    const out = await runCost({
      storeRoot,
      by: facet.data,
      sinceMs,
      json: args.json ?? false,
      cache: args.cache ?? false,
    });
    process.stdout.write(`${out}\n`);
  },
});
```

- [ ] Register in `apps/cli/src/main.ts`: add `import { costCommand } from "./commands/cost/index.js";` beside the `auditCommand` import and `cost: costCommand,` inside the root `subCommands` map.
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/cost/cost.test.ts` — expect PASS (7 tests).
- [ ] Run `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts` — expect PASS (the new files import stats symbols only via `@megasaver/core`).
- [ ] Run `pnpm --filter @megasaver/cli typecheck && pnpm exec biome check apps/cli/src apps/cli/test/cost` — expect clean.
- [ ] Commit: `feat(cli): add mega cost command`

---

### Task 6: DoD closeout — changeset, verify, smoke evidence, wiki

**Files:**
- `.changeset/cost-ledger.md` (new)
- `wiki/entities/cli.md`, `wiki/entities/stats.md`, `wiki/index.md`, `wiki/log.md` (edit)

**Steps:**

- [ ] Add `.changeset/cost-ledger.md`:

```md
---
"@megasaver/stats": minor
"@megasaver/core": minor
"@megasaver/cli": minor
---

Add the unified cost ledger: pure `buildCostLedger` rollup in stats, core
re-export, and the read-only `mega cost` command (receipts only, explicit
UNKNOWN bucket, measured savings pairs only, tokens not dollars).
```

- [ ] Commit: `chore: add cost-ledger changeset`
- [ ] Run `pnpm verify` at the branch tip — expect green (lint + typecheck + all tests + conventions check).
- [ ] Capture CLI smoke evidence (DoD #5) against a scratch store with one fixture usage line and one overlay events file: run `mega cost`, `mega cost --by session`, `mega cost --json`, `mega cost --since 7d`; save the terminal capture to the task report.
- [ ] Update `wiki/entities/cli.md` (add `mega cost` to the command surface), `wiki/entities/stats.md` (cost-ledger module note under the honest-metrics section), `wiki/index.md` (entity line mentions), and append a timestamped entry to `wiki/log.md`.
- [ ] Commit: `docs(wiki): record cost-ledger feature`
- [ ] Request external review per §9.6: `code-reviewer` in a fresh context (author ≠ reviewer), then `verifier` with the smoke capture + `pnpm verify` output as evidence.
