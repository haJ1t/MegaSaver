# Phase 8 — Context Audit & Token-Savings Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate MegaSaver's scattered savings signals into one deterministic, persisted, windowed audit summary that answers *"would've been 70k tokens, was 23k, 67% saved"* — by **extending `@megasaver/stats`** with an additive `AuditEvent` family + pure `summarizeAudit(events, opts)` + a JSONL reader/writer, re-exporting through `@megasaver/core`, adding **one** read-only MCP tool (`audit_token_usage`, 23 → 24) and a `mega audit` CLI group (`report/last/session/export`).

**Architecture:** A discriminated-union `AuditEvent` (five scalar-only kinds: `context_pack_built`, `rule_applied`, `failure_avoided`, `memory_retrieved`, `tool_route`) is appended to a **sibling** log `<store>/stats/<projectId>/<sessionId>.audit.jsonl` (the byte `.events.jsonl` is untouched). A pure `summarizeAudit` folds events in one exhaustive `switch` with window filtering (`session|week|all`) and derives `tokensSaved`/`percentageSaved`. Phase 8 imports **no token estimator** — `tokensBefore/After` arrive already-estimated from Phase 3's `PackAudit` (carried verbatim into a `context_pack_built` event). The reader (`readAuditEvents`) is the only disk read; the summarizer is store-free and unit-tests like `auditPack`. `@megasaver/core` re-exports the four new symbols (CLI/MCP never import `@megasaver/stats` directly — cycle guard). The MCP tool and CLI commands are thin handlers (mirrors Phases 4–7). One representative emission (`context_pack_built` on the build path) ships to prove the demo; the other four emissions are fast-follows (the summarizer already handles all five kinds).

**Tech Stack:** TypeScript (strict ESM, `exactOptionalPropertyTypes`), zod (`discriminatedUnion`), vitest, citty (CLI), `@modelcontextprotocol/sdk`, pnpm + turbo, biome. Reuses `@megasaver/stats` store machinery (`StatsStore`, JSONL append, `StatsError`) and `@megasaver/shared` branded ids. **No new error codes** — `schema_invalid` / `store_corrupt` already exist in `statsErrorCodeSchema`.

**Spec:** `docs/superpowers/specs/2026-06-12-phase8-audit-dashboard-design.md`
**Working dir:** `.worktrees/phase8-audit` (branch `feat/phase8-audit-dashboard`, off `main` @ Phase 7).

**Test commands:** per-package `pnpm --filter @megasaver/<pkg> test <pattern>`; type `pnpm --filter @megasaver/<pkg> typecheck`. Final gate: `pnpm verify` (= `pnpm lint && pnpm typecheck && pnpm test && pnpm conventions:check`; lint is `biome check .` over the whole repo — run it, the per-package turbo lint misses repo-wide format/import-sort). Run `biome check --write` on new files before committing so lint stays clean. Workspace packages resolve to built `dist/`; if a dependent test fails on an unresolved `@megasaver/*` import, build that dep first (`pnpm --filter @megasaver/stats build`, `pnpm --filter @megasaver/core build`).

---

## File Structure

**Create (stats):**
- `packages/stats/src/audit-event.ts` — discriminated-union `AuditEvent` schema + members
- `packages/stats/src/audit-summary.ts` — `AuditSummary`/`AuditWindow` schema + pure `summarizeAudit`
- `packages/stats/src/audit-store.ts` — `appendAuditEvent` + `readAuditEvents`
- `packages/stats/test/audit-event.test.ts`
- `packages/stats/test/audit-summary.test.ts`
- `packages/stats/test/audit-store.test.ts`

**Modify (stats):**
- `packages/stats/src/index.ts` — barrel exports
- `packages/stats/test/dependency-graph.test.ts` — assert allow-list unchanged

**Modify (core):**
- `packages/core/src/context-gate.ts` — extend the stats re-export block
- `packages/core/test/audit-reexport.test.ts` (create)

**Create (mcp-bridge):**
- `packages/mcp-bridge/src/tools/audit-token-usage.ts`
- `packages/mcp-bridge/test/tools/audit-token-usage.test.ts`

**Modify (mcp-bridge):**
- `packages/mcp-bridge/src/tool-name.ts` (23 → 24) + `test/tool-name.test-d.ts`
- `packages/mcp-bridge/src/server.ts` (import + `TOOL_DEFS` + dispatch)
- `packages/mcp-bridge/test/server.e2e.test.ts` (count 23 → 24 + a round-trip)

**Create (cli):** `apps/cli/src/commands/audit/{index,report,last,session,export,shared}.ts` + `apps/cli/test/audit.test.ts`.
**Modify (cli):** `apps/cli/src/main.ts`.

**Create (release):** `.changeset/phase8-audit-dashboard.md`.

**Emission (representative, Task 11):**
- `packages/context-gate/src/run.ts` OR the `mega context build` path — emit one `context_pack_built` audit event (the build path that holds the `ContextPack`).

---

## Task 1: Audit event union — `audit-event.ts`

**Files:**
- Create: `packages/stats/src/audit-event.ts`
- Test: `packages/stats/test/audit-event.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/stats/test/audit-event.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { auditEventSchema } from "../src/audit-event.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "evt-1",
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  createdAt: "2026-06-12T12:00:00.000Z",
};

describe("auditEventSchema", () => {
  it("parses a context_pack_built event", () => {
    const e = auditEventSchema.parse({
      ...base,
      kind: "context_pack_built",
      filesConsidered: 5,
      filesIncluded: 2,
      filesExcluded: 3,
      blocksConsidered: 8,
      blocksIncluded: 3,
      blocksExcluded: 5,
      tokensBefore: 7000,
      tokensAfter: 2300,
    });
    expect(e.kind).toBe("context_pack_built");
  });

  it("parses rule_applied, memory_retrieved, failure_avoided, tool_route", () => {
    expect(auditEventSchema.parse({ ...base, kind: "rule_applied" }).kind).toBe("rule_applied");
    expect(auditEventSchema.parse({ ...base, kind: "memory_retrieved" }).kind).toBe(
      "memory_retrieved",
    );
    expect(
      auditEventSchema.parse({ ...base, kind: "failure_avoided", retryTokensAvoided: 1200 }).kind,
    ).toBe("failure_avoided");
    expect(
      auditEventSchema.parse({
        ...base,
        kind: "tool_route",
        toolsConsidered: 10,
        toolsAllowed: 3,
        toolSchemasReduced: 7,
      }).kind,
    ).toBe("tool_route");
  });

  it("rejects an unknown kind", () => {
    expect(auditEventSchema.safeParse({ ...base, kind: "nope" }).success).toBe(false);
  });

  it("rejects an unknown key (strict)", () => {
    expect(
      auditEventSchema.safeParse({ ...base, kind: "rule_applied", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects a negative pack integer", () => {
    expect(
      auditEventSchema.safeParse({
        ...base,
        kind: "context_pack_built",
        filesConsidered: -1,
        filesIncluded: 0,
        filesExcluded: 0,
        blocksConsidered: 0,
        blocksIncluded: 0,
        blocksExcluded: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/stats test audit-event`
Expected: FAIL — cannot find `../src/audit-event.js`.

- [ ] **Step 3: Create `packages/stats/src/audit-event.ts`**

```ts
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

const auditEventBase = {
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  projectId: projectIdSchema,
  createdAt: z.string().datetime({ offset: true }),
};

export const contextPackBuiltEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("context_pack_built"),
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
  })
  .strict();

export const ruleAppliedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("rule_applied") })
  .strict();

export const failureAvoidedEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("failure_avoided"),
    retryTokensAvoided: z.number().int().nonnegative(),
  })
  .strict();

export const memoryRetrievedEventSchema = z
  .object({ ...auditEventBase, kind: z.literal("memory_retrieved") })
  .strict();

export const toolRouteEventSchema = z
  .object({
    ...auditEventBase,
    kind: z.literal("tool_route"),
    toolsConsidered: z.number().int().nonnegative(),
    toolsAllowed: z.number().int().nonnegative(),
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export const auditEventSchema = z.discriminatedUnion("kind", [
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
]);

export type AuditEvent = z.infer<typeof auditEventSchema>;
```

- [ ] **Step 4: Build stats + run test to verify it passes**

Run: `pnpm --filter @megasaver/stats test audit-event`
Expected: PASS. (If `@megasaver/shared` won't resolve: `pnpm --filter @megasaver/shared build` first.)

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/audit-event.ts packages/stats/test/audit-event.test.ts
git commit -m "feat(stats): Phase 8 AuditEvent discriminated union"
```

---

## Task 2: Pure summarizer — `audit-summary.ts`

**Files:**
- Create: `packages/stats/src/audit-summary.ts`
- Test: `packages/stats/test/audit-summary.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/stats/test/audit-summary.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/audit-event.js";
import { summarizeAudit } from "../src/audit-summary.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-06-12T12:00:00.000Z";
const env = { window: "all" as const, now: () => NOW };

const base = (createdAt = NOW) => ({
  id: "e",
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  createdAt,
});

const pack = (overrides: Partial<AuditEvent> = {}): AuditEvent =>
  ({
    ...base(),
    kind: "context_pack_built",
    filesConsidered: 5,
    filesIncluded: 2,
    filesExcluded: 3,
    blocksConsidered: 8,
    blocksIncluded: 3,
    blocksExcluded: 5,
    tokensBefore: 7000,
    tokensAfter: 2300,
    ...overrides,
  }) as AuditEvent;

describe("summarizeAudit", () => {
  it("returns an all-zero summary for no events", () => {
    const s = summarizeAudit([], env);
    expect(s.eventsTotal).toBe(0);
    expect(s.tokensBefore).toBe(0);
    expect(s.tokensSaved).toBe(0);
    expect(s.percentageSaved).toBe(0);
  });

  it("folds a single context_pack_built event and derives savings", () => {
    const s = summarizeAudit([pack()], env);
    expect(s.tokensBefore).toBe(7000);
    expect(s.tokensAfter).toBe(2300);
    expect(s.tokensSaved).toBe(4700);
    expect(s.percentageSaved).toBe(Math.round((4700 / 7000) * 100));
    expect(s.filesConsidered).toBe(5);
    expect(s.blocksIncluded).toBe(3);
  });

  it("sums multiple packs", () => {
    const s = summarizeAudit([pack(), pack()], env);
    expect(s.tokensBefore).toBe(14000);
    expect(s.tokensAfter).toBe(4600);
    expect(s.filesConsidered).toBe(10);
  });

  it("counts FORGE, memory, and tool events", () => {
    const events: AuditEvent[] = [
      { ...base(), kind: "rule_applied" } as AuditEvent,
      { ...base(), kind: "rule_applied" } as AuditEvent,
      { ...base(), kind: "failure_avoided", retryTokensAvoided: 1200 } as AuditEvent,
      { ...base(), kind: "memory_retrieved" } as AuditEvent,
      {
        ...base(),
        kind: "tool_route",
        toolsConsidered: 10,
        toolsAllowed: 3,
        toolSchemasReduced: 7,
      } as AuditEvent,
    ];
    const s = summarizeAudit(events, env);
    expect(s.rulesApplied).toBe(2);
    expect(s.repeatedFailuresAvoided).toBe(1);
    expect(s.retryCostSaved).toBe(1200);
    expect(s.memoriesRetrieved).toBe(1);
    expect(s.toolSchemasReduced).toBe(7);
    expect(s.eventsTotal).toBe(5);
  });

  it("floors tokensSaved at 0 when after > before", () => {
    const s = summarizeAudit([pack({ tokensBefore: 100, tokensAfter: 200 })], env);
    expect(s.tokensSaved).toBe(0);
    expect(s.percentageSaved).toBe(0);
  });

  it("filters by the week window using injected now", () => {
    const sixDaysAgo = "2026-06-06T12:00:00.000Z";
    const eightDaysAgo = "2026-06-04T12:00:00.000Z";
    const events = [pack({ createdAt: sixDaysAgo }), pack({ createdAt: eightDaysAgo })];
    const s = summarizeAudit(events, { window: "week", now: () => NOW });
    expect(s.eventsTotal).toBe(1);
    expect(s.tokensBefore).toBe(7000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/stats test audit-summary`
Expected: FAIL — cannot find `../src/audit-summary.js`.

- [ ] **Step 3: Create `packages/stats/src/audit-summary.ts`**

```ts
import { z } from "zod";
import type { AuditEvent } from "./audit-event.js";

export const auditWindowSchema = z.enum(["session", "week", "all"]);
export type AuditWindow = z.infer<typeof auditWindowSchema>;

export const auditSummarySchema = z
  .object({
    window: auditWindowSchema,
    eventsTotal: z.number().int().nonnegative(),
    filesConsidered: z.number().int().nonnegative(),
    filesIncluded: z.number().int().nonnegative(),
    filesExcluded: z.number().int().nonnegative(),
    blocksConsidered: z.number().int().nonnegative(),
    blocksIncluded: z.number().int().nonnegative(),
    blocksExcluded: z.number().int().nonnegative(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    tokensSaved: z.number().int().nonnegative(),
    percentageSaved: z.number().min(0).max(100),
    repeatedFailuresAvoided: z.number().int().nonnegative(),
    rulesApplied: z.number().int().nonnegative(),
    retryCostSaved: z.number().int().nonnegative(),
    memoriesRetrieved: z.number().int().nonnegative(),
    toolSchemasReduced: z.number().int().nonnegative(),
  })
  .strict();

export type AuditSummary = z.infer<typeof auditSummarySchema>;

export type SummarizeAuditOptions = { window: AuditWindow; now: () => string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function withinWindow(event: AuditEvent, opts: SummarizeAuditOptions): boolean {
  if (opts.window !== "week") return true;
  const cutoff = Date.parse(opts.now()) - WEEK_MS;
  return Date.parse(event.createdAt) >= cutoff;
}

export function summarizeAudit(
  events: readonly AuditEvent[],
  opts: SummarizeAuditOptions,
): AuditSummary {
  const acc = {
    eventsTotal: 0,
    filesConsidered: 0,
    filesIncluded: 0,
    filesExcluded: 0,
    blocksConsidered: 0,
    blocksIncluded: 0,
    blocksExcluded: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    repeatedFailuresAvoided: 0,
    rulesApplied: 0,
    retryCostSaved: 0,
    memoriesRetrieved: 0,
    toolSchemasReduced: 0,
  };

  for (const event of events) {
    if (!withinWindow(event, opts)) continue;
    acc.eventsTotal += 1;
    switch (event.kind) {
      case "context_pack_built":
        acc.filesConsidered += event.filesConsidered;
        acc.filesIncluded += event.filesIncluded;
        acc.filesExcluded += event.filesExcluded;
        acc.blocksConsidered += event.blocksConsidered;
        acc.blocksIncluded += event.blocksIncluded;
        acc.blocksExcluded += event.blocksExcluded;
        acc.tokensBefore += event.tokensBefore;
        acc.tokensAfter += event.tokensAfter;
        break;
      case "rule_applied":
        acc.rulesApplied += 1;
        break;
      case "failure_avoided":
        acc.repeatedFailuresAvoided += 1;
        acc.retryCostSaved += event.retryTokensAvoided;
        break;
      case "memory_retrieved":
        acc.memoriesRetrieved += 1;
        break;
      case "tool_route":
        acc.toolSchemasReduced += event.toolSchemasReduced;
        break;
    }
  }

  const tokensSaved = Math.max(0, acc.tokensBefore - acc.tokensAfter);
  const percentageSaved =
    acc.tokensBefore > 0 ? Math.round((tokensSaved / acc.tokensBefore) * 100) : 0;

  return auditSummarySchema.parse({
    window: opts.window,
    ...acc,
    tokensSaved,
    percentageSaved,
  });
}
```

> **WHY the exhaustive `switch`:** adding a sixth `AuditEvent` kind makes
> this `switch` non-exhaustive and TypeScript flags it (totality guard) —
> the summary can never silently miss a metric.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/stats test audit-summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/audit-summary.ts packages/stats/test/audit-summary.test.ts
git commit -m "feat(stats): pure summarizeAudit with window filtering"
```

---

## Task 3: Store reader/writer — `audit-store.ts`

**Files:**
- Create: `packages/stats/src/audit-store.ts`
- Test: `packages/stats/test/audit-store.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/stats/test/audit-store.test.ts`)

```ts
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/audit-event.js";
import { appendAuditEvent, readAuditEvents } from "../src/audit-store.js";
import { StatsError } from "../src/errors.js";
import type { StatsStore } from "../src/store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-audit-"));
  store = { root };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const auditFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.audit.jsonl`);
const byteEventsFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`);

const ruleEvent = (id = "e1"): AuditEvent =>
  ({
    id,
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-06-12T12:00:00.000Z",
    kind: "rule_applied",
  }) as AuditEvent;

describe("appendAuditEvent + readAuditEvents", () => {
  it("appends a terminated JSONL line and round-trips", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    appendAuditEvent({ store, event: ruleEvent("e2") });
    const raw = readFileSync(auditFile(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const events = readAuditEvents(store, PROJECT_ID, SESSION_ID);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("does not touch the byte events log", () => {
    appendAuditEvent({ store, event: ruleEvent() });
    expect(existsSync(byteEventsFile())).toBe(false);
  });

  it("returns [] when the log is absent", () => {
    expect(readAuditEvents(store, PROJECT_ID, SESSION_ID)).toEqual([]);
  });

  it("drops a non-terminated trailing fragment", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    writeFileSync(auditFile(), `${readFileSync(auditFile(), "utf8")}{"partial":true`, {
      flag: "w",
    });
    expect(readAuditEvents(store, PROJECT_ID, SESSION_ID)).toHaveLength(1);
  });

  it("throws store_corrupt on a corrupt terminated line", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    writeFileSync(auditFile(), `${readFileSync(auditFile(), "utf8")}{not json}\n`, { flag: "w" });
    expect(() => readAuditEvents(store, PROJECT_ID, SESSION_ID)).toThrow(StatsError);
  });

  it("throws schema_invalid on an invalid event", () => {
    expect(() =>
      appendAuditEvent({ store, event: { ...ruleEvent(), id: "" } as AuditEvent }),
    ).toThrow(StatsError);
  });

  it("reads every session's audit log when sessionId is omitted", () => {
    const otherSession = "33333333-3333-4333-8333-333333333333" as SessionId;
    appendAuditEvent({ store, event: ruleEvent("e1") });
    appendAuditEvent({
      store,
      event: { ...ruleEvent("e2"), sessionId: otherSession } as AuditEvent,
    });
    expect(readAuditEvents(store, PROJECT_ID)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/stats test audit-store`
Expected: FAIL — cannot find `../src/audit-store.js`.

- [ ] **Step 3: Create `packages/stats/src/audit-store.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { type AuditEvent, auditEventSchema } from "./audit-event.js";
import { StatsError } from "./errors.js";
import type { StatsStore } from "./store.js";

export type AppendAuditEventInput = { store: StatsStore; event: AuditEvent };

function projectDir(store: StatsStore, projectId: ProjectId): string {
  return join(store.root, "stats", projectId);
}

function auditPath(store: StatsStore, projectId: ProjectId, sessionId: SessionId): string {
  return join(projectDir(store, projectId), `${sessionId}.audit.jsonl`);
}

function parseLog(path: string): AuditEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  // Committed events are exactly the segments preceding a "\n"; a partial,
  // non-terminated trailing fragment (a crash mid-append) is dropped.
  const lines = raw.split("\n").slice(0, -1);
  const events: AuditEvent[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new StatsError("store_corrupt");
    }
    const parsed = auditEventSchema.safeParse(json);
    if (!parsed.success) {
      throw new StatsError("store_corrupt");
    }
    events.push(parsed.data);
  }
  return events;
}

export function appendAuditEvent(input: AppendAuditEventInput): void {
  const parsed = auditEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;
  const path = auditPath(input.store, event.projectId, event.sessionId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export function readAuditEvents(
  store: StatsStore,
  projectId: ProjectId,
  sessionId?: SessionId,
): AuditEvent[] {
  if (sessionId !== undefined) {
    return parseLog(auditPath(store, projectId, sessionId));
  }
  const dir = projectDir(store, projectId);
  if (!existsSync(dir)) return [];
  const out: AuditEvent[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".audit.jsonl")) {
      out.push(...parseLog(join(dir, name)));
    }
  }
  return out;
}
```

> **WHY no running `.json` summary (unlike `appendEvent`):** the audit
> summary is windowed (`session|week|all`); a single stored fold cannot
> serve every window, and event volume per session is tiny, so it is
> derived on read by `summarizeAudit` — no summary-drift risk, no second
> atomic write.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/stats test audit-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/audit-store.ts packages/stats/test/audit-store.test.ts
git commit -m "feat(stats): audit-event JSONL writer + reader (sibling log)"
```

---

## Task 4: Stats barrel exports + dependency-graph guard

**Files:**
- Modify: `packages/stats/src/index.ts`
- Modify: `packages/stats/test/dependency-graph.test.ts`

- [ ] **Step 1: Add the guard assertion** to `packages/stats/test/dependency-graph.test.ts` (inside the existing `describe`, after the last `it`):

```ts
  it("Phase 8 audit additions do not widen the allow-list", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    expect(deps).not.toContain("@megasaver/context-pruner");
    expect(deps).not.toContain("@megasaver/core");
    for (const dep of deps) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });
```

- [ ] **Step 2: Run test to verify the guard passes (allow-list already correct, additions are source-only)**

Run: `pnpm --filter @megasaver/stats test dependency-graph`
Expected: PASS (no new deps were added — the audit modules import only `@megasaver/shared` + `zod`).

- [ ] **Step 3: Append to `packages/stats/src/index.ts`**

```ts
export {
  auditEventSchema,
  type AuditEvent,
  contextPackBuiltEventSchema,
  ruleAppliedEventSchema,
  failureAvoidedEventSchema,
  memoryRetrievedEventSchema,
  toolRouteEventSchema,
} from "./audit-event.js";

export {
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
  summarizeAudit,
  type SummarizeAuditOptions,
} from "./audit-summary.js";

export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
} from "./audit-store.js";
```

- [ ] **Step 4: Build stats + run the full stats suite**

Run: `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/stats test`
Expected: PASS (all stats tests, including the existing byte `store.test.ts` untouched).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add packages/stats/src/index.ts packages/stats/test/dependency-graph.test.ts
git commit -m "feat(stats): export audit surface; pin allow-list"
```

---

## Task 5: Core re-export

**Files:**
- Modify: `packages/core/src/context-gate.ts` (the existing stats re-export block)
- Test: `packages/core/test/audit-reexport.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/core/test/audit-reexport.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  type AuditEvent,
  type AuditSummary,
  appendAuditEvent,
  auditEventSchema,
  auditSummarySchema,
  auditWindowSchema,
  readAuditEvents,
  summarizeAudit,
} from "../src/index.js";

describe("core re-exports the Phase 8 audit surface", () => {
  it("exposes the audit fns and schemas", () => {
    expect(typeof summarizeAudit).toBe("function");
    expect(typeof appendAuditEvent).toBe("function");
    expect(typeof readAuditEvents).toBe("function");
    expect(auditWindowSchema.options).toEqual(["session", "week", "all"]);
    const summary: AuditSummary = summarizeAudit([], { window: "all", now: () => "2026-06-12T00:00:00.000Z" });
    expect(summary.eventsTotal).toBe(0);
    expect(auditSummarySchema.safeParse(summary).success).toBe(true);
    const event: AuditEvent = auditEventSchema.parse({
      id: "e",
      sessionId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-06-12T12:00:00.000Z",
      kind: "rule_applied",
    });
    expect(event.kind).toBe("rule_applied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test audit-reexport`
Expected: FAIL — those names are not exported from core yet.

- [ ] **Step 3: Extend the stats re-export block in `packages/core/src/context-gate.ts`.** Find the existing block (it currently re-exports `appendEvent, readSummary, StatsError, …` from `@megasaver/stats`) and add a second export statement immediately after it:

```ts
export {
  appendAuditEvent,
  type AppendAuditEventInput,
  readAuditEvents,
  summarizeAudit,
  type SummarizeAuditOptions,
  auditEventSchema,
  type AuditEvent,
  auditSummarySchema,
  type AuditSummary,
  auditWindowSchema,
  type AuditWindow,
} from "@megasaver/stats";
```

- [ ] **Step 4: Build stats + core, run test to verify it passes**

Run: `pnpm --filter @megasaver/stats build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/core test audit-reexport`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context-gate.ts packages/core/test/audit-reexport.test.ts
git commit -m "feat(core): re-export Phase 8 audit surface from stats"
```

---

## Task 6: MCP tool — `audit_token_usage` handler

**Files:**
- Create: `packages/mcp-bridge/src/tools/audit-token-usage.ts`
- Test: `packages/mcp-bridge/test/tools/audit-token-usage.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/mcp-bridge/test/tools/audit-token-usage.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditEvent, appendAuditEvent } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleAuditTokenUsage } from "../../src/tools/audit-token-usage.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;
const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;

// Minimal registry stub: only listProjects is consulted by the handler.
const registry = {
  listProjects: () => [{ id: PROJECT_ID, name: "demo" }],
} as unknown as Parameters<typeof handleAuditTokenUsage>[0]["registry"];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-audit-mcp-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const packEvent = (): AuditEvent =>
  ({
    id: "e1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-06-12T12:00:00.000Z",
    kind: "context_pack_built",
    filesConsidered: 5,
    filesIncluded: 2,
    filesExcluded: 3,
    blocksConsidered: 8,
    blocksIncluded: 3,
    blocksExcluded: 5,
    tokensBefore: 7000,
    tokensAfter: 2300,
  }) as AuditEvent;

describe("handleAuditTokenUsage", () => {
  it("summarizes a session window", async () => {
    appendAuditEvent({ store: { root }, event: packEvent() });
    const out = await handleAuditTokenUsage(
      { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
      { projectId: PROJECT_ID, sessionId: SESSION_ID, window: "session" },
    );
    expect(out.tokensBefore).toBe(7000);
    expect(out.tokensAfter).toBe(2300);
    expect(out.percentageSaved).toBe(67);
  });

  it("requires a sessionId for the session window", async () => {
    await expect(
      handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: PROJECT_ID, window: "session" },
      ),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("rejects a bad window", async () => {
    await expect(
      handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: PROJECT_ID, window: "year" },
      ),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });

  it("maps an unknown project to resource_not_found", async () => {
    try {
      await handleAuditTokenUsage(
        { registry, storeRoot: root, now: () => "2026-06-12T12:00:00.000Z" },
        { projectId: "99999999-9999-4999-8999-999999999999", window: "all" },
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpBridgeError);
      expect((err as McpBridgeError).code).toBe("resource_not_found");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/mcp-bridge test audit-token-usage`
Expected: FAIL — cannot find `../../src/tools/audit-token-usage.js`.

- [ ] **Step 3: Create `packages/mcp-bridge/src/tools/audit-token-usage.ts`**

```ts
import {
  type AuditSummary,
  type CoreRegistry,
  auditWindowSchema,
  readAuditEvents,
  summarizeAudit,
} from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export type AuditTokenUsageEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
};

const inputSchema = z
  .object({
    projectId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    window: z.string().optional(),
  })
  .strict();

export async function handleAuditTokenUsage(
  env: AuditTokenUsageEnv,
  rawArgs: unknown,
): Promise<AuditSummary> {
  const parsed = inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, sessionId } = parsed.data;

  const window = parsed.data.window ?? (sessionId !== undefined ? "session" : "all");
  const parsedWindow = auditWindowSchema.safeParse(window);
  if (!parsedWindow.success) {
    throw new McpBridgeError("validation_failed", `invalid window "${window}" (session | week | all)`);
  }
  if (parsedWindow.data === "session" && sessionId === undefined) {
    throw new McpBridgeError("validation_failed", 'window "session" requires a sessionId');
  }

  const project = env.registry.listProjects().find((p) => p.id === (projectId as ProjectId));
  if (!project) {
    throw new McpBridgeError("resource_not_found", `project not found: ${projectId}`);
  }

  try {
    const events = readAuditEvents(
      { root: env.storeRoot },
      projectId as ProjectId,
      parsedWindow.data === "session" ? (sessionId as SessionId) : undefined,
    );
    return summarizeAudit(events, { window: parsedWindow.data, now: env.now });
  } catch (err) {
    throw new McpBridgeError("validation_failed", err instanceof Error ? err.message : "audit failed");
  }
}
```

- [ ] **Step 4: Build core + run test to verify it passes**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/mcp-bridge test audit-token-usage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/audit-token-usage.ts packages/mcp-bridge/test/tools/audit-token-usage.test.ts
git commit -m "feat(mcp): audit_token_usage handler (read-only summary)"
```

---

## Task 7: Register `audit_token_usage` in the enum + server (23 → 24)

**Files:**
- Modify: `packages/mcp-bridge/src/tool-name.ts`
- Modify: `packages/mcp-bridge/test/tool-name.test-d.ts`
- Modify: `packages/mcp-bridge/src/server.ts`

- [ ] **Step 1: Add `audit_token_usage` as the FIRST member of `mcpToolNameSchema`** in `packages/mcp-bridge/src/tool-name.ts` (alphabetic — it sorts before `build_task_plan`):

```ts
export const mcpToolNameSchema = z.enum([
  "audit_token_usage",
  "build_task_plan",
```

(leave the rest of the enum unchanged). Also extend the leading comment's phase list with "and the Phase 8 Audit tool (audit_token_usage)."

- [ ] **Step 2: Add the member to the `test-d` tuple** in `packages/mcp-bridge/test/tool-name.test-d.ts` — insert `"audit_token_usage",` as the first element of the `members` array.

- [ ] **Step 3: Wire the handler into `packages/mcp-bridge/src/server.ts`:**

3a. Import (with the other tool imports, alphabetic):

```ts
import { handleAuditTokenUsage } from "./tools/audit-token-usage.js";
```

3b. Add to `TOOL_DEFS` (insert as the first entry, before `build_task_plan`):

```ts
  { name: "audit_token_usage", description: "Summarize recorded token/context savings for a project or session." },
```

3c. Add the dispatch case (in the `switch (toolName)`, alongside the others):

```ts
      case "audit_token_usage":
        return handleAuditTokenUsage(
          { registry: deps.registry, storeRoot: deps.storeRoot, now },
          args,
        );
```

(`now` is already defined in `runServer`/`dispatch` scope — it is the same injected clock the other handlers use.)

- [ ] **Step 4: Build + run the tool-name and a focused server test**

Run: `pnpm --filter @megasaver/mcp-bridge build && pnpm --filter @megasaver/mcp-bridge test tool-name`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tool-name.ts packages/mcp-bridge/test/tool-name.test-d.ts packages/mcp-bridge/src/server.ts
git commit -m "feat(mcp): register audit_token_usage (23 -> 24 tools)"
```

---

## Task 8: Server e2e — 24 tools + round-trip

**Files:**
- Modify: `packages/mcp-bridge/test/server.e2e.test.ts`

- [ ] **Step 1: Update the count test.** Change the `"lists 23 tools"` test to 24 and assert the new name:

```ts
  it("lists 24 tools", async () => {
    const { client, server } = await connectWithTools();
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(24);
    expect(tools.map((t) => t.name)).toContain("audit_token_usage");
    await server.close();
  });
```

- [ ] **Step 2: Add a round-trip test** (after the `route_tools_for_task` test). It seeds a `context_pack_built` audit event via `appendAuditEvent` (re-exported through core) into the same `storeRoot` the server uses, then calls the tool. Use the e2e file's existing `connectWithTools` helper, its `PROJECT_ID`, and the store root it builds (read the top of the file to reuse the exact `storeRoot` variable + a valid session id constant; if none exists, declare `const AUDIT_SESSION_ID = "11111111-1111-4111-8111-111111111111";`):

```ts
  it("audit_token_usage summarizes recorded savings", async () => {
    const { client, server } = await connectWithTools();
    appendAuditEvent({
      store: { root: storeRoot },
      event: {
        id: "a1",
        sessionId: AUDIT_SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: "2026-06-12T12:00:00.000Z",
        kind: "context_pack_built",
        filesConsidered: 5,
        filesIncluded: 2,
        filesExcluded: 3,
        blocksConsidered: 8,
        blocksIncluded: 3,
        blocksExcluded: 5,
        tokensBefore: 7000,
        tokensAfter: 2300,
      },
    });
    const res = (await client.callTool({
      name: "audit_token_usage",
      arguments: { projectId: PROJECT_ID, sessionId: AUDIT_SESSION_ID, window: "session" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      tokensBefore: number;
      tokensAfter: number;
      percentageSaved: number;
    };
    expect(payload.tokensBefore).toBe(7000);
    expect(payload.tokensAfter).toBe(2300);
    expect(payload.percentageSaved).toBe(67);
    await server.close();
  });
```

Add the import at the top of the e2e file (with the other `@megasaver/core` imports):

```ts
import { appendAuditEvent } from "@megasaver/core";
```

(If `appendAuditEvent` is already imported in a combined `@megasaver/core` import line, add it to that line instead of a new statement.)

- [ ] **Step 3: Build core + mcp-bridge, run e2e**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/mcp-bridge build && pnpm --filter @megasaver/mcp-bridge test server.e2e`
Expected: PASS (24 tools + the new round-trip).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-bridge/test/server.e2e.test.ts
git commit -m "test(mcp): e2e 24 tools + audit_token_usage round-trip"
```

---

## Task 9: CLI `mega audit` — shared + report

**Files:**
- Create: `apps/cli/src/commands/audit/shared.ts`
- Create: `apps/cli/src/commands/audit/report.ts`
- Test: `apps/cli/test/audit.test.ts`

- [ ] **Step 1: Write the failing test** (`apps/cli/test/audit.test.ts`)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuditEvent, appendAuditEvent } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditReport } from "../src/commands/audit/report.js";

// These ids must match a project + session created in the store via the
// shared CLI test helpers. Reuse the test harness the existing CLI suites
// use to seed a project/session; the snippet below assumes a helper
// `seedProjectSession(root)` returning { projectName, projectId, sessionId }.
// If the suite uses a different seeding util, swap to it — the assertions
// on stdout are what matter.

let root: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-audit-"));
  lines.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = {
  storeFlag: root,
  cwd: root,
  home: root,
  xdgDataHome: undefined,
  platform: process.platform,
  localAppData: undefined,
};

describe("mega audit report", () => {
  it("rejects a bad --window with exit 1", async () => {
    const code = await runAuditReport({
      projectName: "demo",
      windowFlag: "year",
      sessionFlag: undefined,
      ...env,
      stdout,
      stderr,
      json: false,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid window");
  });
});
```

> **Note for the implementer:** the happy-path stdout assertion (headline
> string `would've been 7000 tokens, was 2300, 67% saved`) requires a
> seeded project + a `context_pack_built` event in `root`. Reuse the
> project-seeding helper the sibling CLI suites already use (e.g. the one
> in `apps/cli/test/tools.test.ts` / `apps/cli/test/shared`), then
> `appendAuditEvent({ store: { root }, event: <packEvent for that session> })`
> before calling `runAuditReport({ ..., windowFlag: "session", sessionFlag: <id> })`,
> and assert `lines.join("\n")` contains the headline. The bad-window test
> above needs no seeding and locks the boundary-validation behaviour.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test audit`
Expected: FAIL — cannot find `../src/commands/audit/report.js`.

- [ ] **Step 3a: Create `apps/cli/src/commands/audit/shared.ts`**

```ts
import type { AuditSummary } from "@megasaver/core";

export function formatAuditCards(summary: AuditSummary): string[] {
  return [
    `window: ${summary.window}  (events: ${summary.eventsTotal})`,
    "Context pruning:",
    `  files:  ${summary.filesIncluded}/${summary.filesConsidered} included`,
    `  blocks: ${summary.blocksIncluded}/${summary.blocksConsidered} included`,
    `  tokens: ${summary.tokensBefore} -> ${summary.tokensAfter}`,
    "FORGE:",
    `  rules applied: ${summary.rulesApplied}`,
    `  repeated failures avoided: ${summary.repeatedFailuresAvoided}`,
    `  retry cost saved: ${summary.retryCostSaved} tokens`,
    "Memory:",
    `  memories retrieved: ${summary.memoriesRetrieved}`,
    "Tools:",
    `  tool schemas reduced: ${summary.toolSchemasReduced}`,
    `would've been ${summary.tokensBefore} tokens, was ${summary.tokensAfter}, ${summary.percentageSaved}% saved`,
  ];
}
```

- [ ] **Step 3b: Create `apps/cli/src/commands/audit/report.ts`**

```ts
import { auditWindowSchema, readAuditEvents, summarizeAudit } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatAuditCards } from "./shared.js";

export type RunAuditReportInput = {
  projectName: string;
  windowFlag: string | undefined;
  sessionFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
};

export async function runAuditReport(input: RunAuditReportInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const window = input.windowFlag ?? (input.sessionFlag !== undefined ? "session" : "all");
  const parsedWindow = auditWindowSchema.safeParse(window);
  if (!parsedWindow.success) {
    input.stderr(`error: invalid window "${window}" (session | week | all)`);
    return 1;
  }
  let sessionId: ReturnType<typeof sessionIdSchema.parse> | undefined;
  if (parsedWindow.data === "session") {
    if (input.sessionFlag === undefined) {
      input.stderr('error: --window session requires --session <id>');
      return 1;
    }
    const parsedSession = sessionIdSchema.safeParse(input.sessionFlag);
    if (!parsedSession.success) {
      input.stderr(`error: invalid session id "${input.sessionFlag}"`);
      return 1;
    }
    sessionId = parsedSession.data;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const now = input.now ?? (() => new Date().toISOString());
    const events = readAuditEvents({ root: rootDir }, project.id, sessionId);
    const summary = summarizeAudit(events, { window: parsedWindow.data, now });
    if (input.json) {
      input.stdout(JSON.stringify(summary));
    } else {
      for (const line of formatAuditCards(summary)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditReportCommand = defineCommand({
  meta: { name: "report", description: "Dashboard summary of recorded token/context savings." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    window: { type: "string", description: "session | week | all." },
    session: { type: "string", description: "Session id (required for --window session)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditReport({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Build core + run test to verify it passes**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli test audit`
Expected: PASS (the bad-window test; add the seeded happy-path assertion per the Step 1 note).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add apps/cli/src/commands/audit/shared.ts apps/cli/src/commands/audit/report.ts apps/cli/test/audit.test.ts
git commit -m "feat(cli): mega audit report (dashboard cards + headline)"
```

---

## Task 10: CLI `mega audit` — last, session, export, group, main

**Files:**
- Create: `apps/cli/src/commands/audit/last.ts`
- Create: `apps/cli/src/commands/audit/session.ts`
- Create: `apps/cli/src/commands/audit/export.ts`
- Create: `apps/cli/src/commands/audit/index.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/audit.test.ts` (append)

- [ ] **Step 1: Append failing tests** to `apps/cli/test/audit.test.ts`:

```ts
import { runAuditExport } from "../src/commands/audit/export.js";

describe("mega audit export", () => {
  it("rejects a non-json --format with exit 1", async () => {
    const code = await runAuditExport({
      projectName: "demo",
      formatFlag: "csv",
      windowFlag: undefined,
      sessionFlag: undefined,
      ...env,
      stdout,
      stderr,
      now: () => "2026-06-12T12:00:00.000Z",
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("invalid format");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test audit`
Expected: FAIL — cannot find `../src/commands/audit/export.js`.

- [ ] **Step 3a: Create `apps/cli/src/commands/audit/last.ts`**

```ts
import { readAuditEvents, summarizeAudit } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatAuditCards } from "./shared.js";

export type RunAuditLastInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
};

export async function runAuditLast(input: RunAuditLastInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    // Newest session by startedAt (Session has startedAt, not createdAt).
    const sessions = [...registry.listSessions(project.id)].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    const newest = sessions[0];
    const now = input.now ?? (() => new Date().toISOString());
    if (!newest) {
      const summary = summarizeAudit([], { window: "session", now });
      if (input.json) input.stdout(JSON.stringify(summary));
      else for (const line of formatAuditCards(summary)) input.stdout(line);
      return 0;
    }
    const events = readAuditEvents({ root: rootDir }, project.id, newest.id);
    const summary = summarizeAudit(events, { window: "session", now });
    if (input.json) input.stdout(JSON.stringify(summary));
    else for (const line of formatAuditCards(summary)) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditLastCommand = defineCommand({
  meta: { name: "last", description: "Audit summary for the most recent session." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditLast({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3b: Create `apps/cli/src/commands/audit/session.ts`**

```ts
import { readAuditEvents, summarizeAudit } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { formatAuditCards } from "./shared.js";

export type RunAuditSessionInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
};

export async function runAuditSession(input: RunAuditSessionInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const session = registry.getSession(parsedSessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(parsedSessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const now = input.now ?? (() => new Date().toISOString());
    const events = readAuditEvents({ root: rootDir }, session.projectId, parsedSessionId);
    const summary = summarizeAudit(events, { window: "session", now });
    if (input.json) input.stdout(JSON.stringify(summary));
    else for (const line of formatAuditCards(summary)) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditSessionCommand = defineCommand({
  meta: { name: "session", description: "Audit summary for one session." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runAuditSession({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 3c: Create `apps/cli/src/commands/audit/export.ts`**

```ts
import { auditWindowSchema, readAuditEvents, summarizeAudit } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

const exportFormatSchema = auditWindowSchema; // placeholder import, replaced below

export type RunAuditExportInput = {
  projectName: string;
  formatFlag: string | undefined;
  windowFlag: string | undefined;
  sessionFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
};

export async function runAuditExport(input: RunAuditExportInput): Promise<0 | 1> {
  const format = input.formatFlag ?? "json";
  if (format !== "json") {
    input.stderr(`error: invalid format "${format}" (json)`);
    return 1;
  }
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const window = input.windowFlag ?? (input.sessionFlag !== undefined ? "session" : "all");
  const parsedWindow = auditWindowSchema.safeParse(window);
  if (!parsedWindow.success) {
    input.stderr(`error: invalid window "${window}" (session | week | all)`);
    return 1;
  }
  let sessionId: ReturnType<typeof sessionIdSchema.parse> | undefined;
  if (parsedWindow.data === "session") {
    if (input.sessionFlag === undefined) {
      input.stderr("error: --window session requires --session <id>");
      return 1;
    }
    const parsedSession = sessionIdSchema.safeParse(input.sessionFlag);
    if (!parsedSession.success) {
      input.stderr(`error: invalid session id "${input.sessionFlag}"`);
      return 1;
    }
    sessionId = parsedSession.data;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const now = input.now ?? (() => new Date().toISOString());
    const events = readAuditEvents({ root: rootDir }, project.id, sessionId);
    const summary = summarizeAudit(events, { window: parsedWindow.data, now });
    input.stdout(JSON.stringify({ summary, events }));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const auditExportCommand = defineCommand({
  meta: { name: "export", description: "Export the audit summary (+events) as JSON." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    format: { type: "string", default: "json", description: "Export format (json)." },
    window: { type: "string", description: "session | week | all." },
    session: { type: "string", description: "Session id (required for --window session)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runAuditExport({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      formatFlag: typeof args.format === "string" ? args.format : undefined,
      windowFlag: typeof args.window === "string" ? args.window : undefined,
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

> **Fix the placeholder import:** delete the line
> `const exportFormatSchema = auditWindowSchema; // placeholder import, replaced below`
> — it exists only to flag that `export` validates `--format` with a
> plain `!== "json"` check (json is the only format this phase), not a zod
> enum. The real validation is the `if (format !== "json")` guard above.

- [ ] **Step 3d: Create `apps/cli/src/commands/audit/index.ts`**

```ts
import { defineCommand } from "citty";
import { auditExportCommand } from "./export.js";
import { auditLastCommand } from "./last.js";
import { auditReportCommand } from "./report.js";
import { auditSessionCommand } from "./session.js";

export { type RunAuditReportInput, runAuditReport, auditReportCommand } from "./report.js";
export { type RunAuditLastInput, runAuditLast, auditLastCommand } from "./last.js";
export { type RunAuditSessionInput, runAuditSession, auditSessionCommand } from "./session.js";
export { type RunAuditExportInput, runAuditExport, auditExportCommand } from "./export.js";

export const auditCommand = defineCommand({
  meta: { name: "audit", description: "Token-savings dashboard: report, last, session, export." },
  subCommands: {
    report: auditReportCommand,
    last: auditLastCommand,
    session: auditSessionCommand,
    export: auditExportCommand,
  },
});
```

- [ ] **Step 3e: Wire into `apps/cli/src/main.ts`** — add the import (with the other command imports, alphabetic near the top):

```ts
import { auditCommand } from "./commands/audit/index.js";
```

and add to `subCommands` (insert as the first entry, before `doctor: doctorCommand,`):

```ts
    audit: auditCommand,
```

- [ ] **Step 4: Build core + run the audit CLI suite**

Run: `pnpm --filter @megasaver/core build && pnpm --filter @megasaver/cli test audit`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add apps/cli/src/commands/audit/ apps/cli/src/main.ts apps/cli/test/audit.test.ts
git commit -m "feat(cli): mega audit last/session/export + group wiring"
```

---

## Task 11: Representative emission — `context_pack_built`

**Files:**
- Modify: the context-pack build path that holds the `ContextPack` (the `mega context build` command handler `apps/cli/src/commands/context/build.ts`, or `packages/context-gate/src/run.ts` if the pack is built there with a `storeRoot` + `sessionId`/`projectId` in scope).
- Test: extend the relevant build test to assert one `context_pack_built` event lands.

> **WHY only one emission ships now:** wiring every producing call site is
> a broad cross-package change. The summarizer already handles all five
> kinds; shipping the `context_pack_built` emission proves the exit demo
> end-to-end. The other four (`rule_applied`, `failure_avoided`,
> `memory_retrieved`, `tool_route`) are declared in the spec (§6d) and land
> as focused fast-follows. (Spec §6d, §12.)

- [ ] **Step 1: Write the failing test.** In the build path's test, after building a pack with a known session/project + `storeRoot`, assert `readAuditEvents({ root }, projectId, sessionId)` contains exactly one `context_pack_built` event whose `tokensBefore`/`tokensAfter` match `auditPack(pack)`:

```ts
import { auditPack } from "@megasaver/context-pruner";
import { readAuditEvents } from "@megasaver/core";
// ... after the build call that wrote to `root`:
const events = readAuditEvents({ root }, projectId, sessionId);
const built = events.filter((e) => e.kind === "context_pack_built");
expect(built).toHaveLength(1);
const a = auditPack(pack);
expect(built[0]).toMatchObject({ tokensBefore: a.tokensBefore, tokensAfter: a.tokensAfter });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/<pkg-of-build-path> test <pattern>`
Expected: FAIL — no audit event is written yet.

- [ ] **Step 3: Emit the event at the build site.** After the pack is built and `auditPack(pack)` is available (import `auditPack` from `@megasaver/context-pruner` and `appendAuditEvent` from `@megasaver/core` — or directly from `@megasaver/stats` if the edit is inside `@megasaver/context-gate`, which already depends on stats), append:

```ts
const a = auditPack(pack);
appendAuditEvent({
  store: { root: storeRoot },
  event: {
    id: newId(),
    sessionId,
    projectId,
    createdAt: now(),
    kind: "context_pack_built",
    filesConsidered: a.filesConsidered,
    filesIncluded: a.filesIncluded,
    filesExcluded: a.filesExcluded,
    blocksConsidered: a.blocksConsidered,
    blocksIncluded: a.blocksIncluded,
    blocksExcluded: a.blocksExcluded,
    tokensBefore: a.tokensBefore,
    tokensAfter: a.tokensAfter,
  },
});
```

Use the build path's existing injected `now`/`newId`/`storeRoot`/`sessionId`/`projectId` (whatever the handler already has). If the build path is CLI-only and has no `newId`, mint with `crypto.randomUUID()` lowercased (matches the lowercase-uuid id convention) — but prefer an injected clock if one exists for test determinism.

> **Important — no re-estimation:** the `tokensBefore`/`tokensAfter` come
> straight from `auditPack(pack)` (Phase 3's `estimateSpanTokens`). This
> task imports **no** token estimator (spec §2).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/<pkg-of-build-path> test <pattern>`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint:fix
git add <edited build-path file(s)> <edited build-path test(s)>
git commit -m "feat: emit context_pack_built audit event on pack build"
```

---

## Task 12: Full gate + changeset

**Files:**
- Create: `.changeset/phase8-audit-dashboard.md`

- [ ] **Step 1: Lint the new files**

Run: `pnpm lint:fix` (= `biome check --write`), then inspect `git diff --stat` to confirm only Phase 8 files were reformatted.

- [ ] **Step 2: Run the CI-equivalent gate**

Run: `pnpm verify`
Expected: lint (`biome check .`) clean, typecheck clean, all tests pass, conventions ok. If a per-package step fails only on an unresolved `@megasaver/*` import, build that dep (`pnpm --filter @megasaver/stats build`, `pnpm --filter @megasaver/core build`) and re-run.

- [ ] **Step 3: Confirm the 24-tool surface end-to-end**

Run: `pnpm --filter @megasaver/mcp-bridge test server.e2e -t "lists 24 tools"`
Expected: PASS.

- [ ] **Step 4: Confirm the headline demo behaviour**

Run: `pnpm --filter @megasaver/stats test audit-summary -t "derives savings"`
Expected: PASS (the `tokensSaved` / `percentageSaved` derivation).

- [ ] **Step 5: Write the changeset** (`.changeset/phase8-audit-dashboard.md`)

```md
---
"@megasaver/stats": minor
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Phase 8 — Context Audit & Token-Savings Dashboard. Extends
@megasaver/stats (no new core entity) with an additive AuditEvent
discriminated union (context_pack_built, rule_applied, failure_avoided,
memory_retrieved, tool_route — scalar-only, no core types so the cycle
guard holds), written to a sibling <store>/stats/<projectId>/<sessionId>
.audit.jsonl (the byte .events.jsonl is untouched — no duplicate
token-saver accounting). New pure summarizeAudit(events, { window, now })
folds events in one exhaustive switch with window filtering
(session|week|all) and derives tokensSaved/percentageSaved using the
same formula as PackAudit; it imports no token estimator — tokensBefore/
After arrive already-estimated from Phase 3's auditPack (estimateSpanTokens)
carried verbatim into a context_pack_built event. New appendAuditEvent /
readAuditEvents JSONL writer+reader (reuses StatsError schema_invalid /
store_corrupt — no new codes). Core re-exports the audit surface (CLI/MCP
never import @megasaver/stats directly). One read-only MCP tool
audit_token_usage (bridge now 24 tools) and a mega audit CLI group
(report / last / session / export --format json) returning the dashboard
cards and the headline "would've been N tokens, was M, P% saved". Ships
the context_pack_built emission on the build path to prove the demo;
rule_applied/failure_avoided/memory_retrieved/tool_route emissions are
fast-follows (the summarizer already handles all five kinds). No LLM, no
new estimator, no GUI changes.
```

(Match the existing `.changeset/` file format if it differs.)

- [ ] **Step 6: Commit**

```bash
git add .changeset/phase8-audit-dashboard.md
git commit -m "chore: changeset for Phase 8 Audit Dashboard"
```

- [ ] **Step 7: Push + PR (when ready)**

```bash
git push -u origin feat/phase8-audit-dashboard
```

Open a PR titled `feat: Phase 8 — Audit Dashboard (23 → 24 tools)` against `main`, linking the spec.

---

## Self-Review Notes

- **Spec coverage:** §4a event union → T1; §4b/§4c summary + pure summarizer → T2; §5 store reader/writer → T3; §6c stats barrel + §9 cycle-guard → T4; §7b core re-export → T5; §7c MCP handler → T6, enum/server wiring → T7, e2e count+round-trip → T8; §7d CLI report → T9, last/session/export/group/main → T10; §6d representative emission → T11; §11 changeset/gate → T12. Every spec section maps to a task.
- **Reconciliation (a) honoured:** all new code lives in `@megasaver/stats` (events/summary/store) + re-exports; **no** new core entity, **no** new store dir in core, **no** new error codes (reuses `schema_invalid`/`store_corrupt`). The cycle guard is asserted in T4. (Spec §6a.)
- **No re-measurement / no estimator reinvention:** T2's summarizer does pure arithmetic; T11 carries `auditPack` integers verbatim; **no** task imports a token estimator and `@megasaver/stats` gains **no** `context-pruner` dep (T4 asserts it). (Spec §2.)
- **Byte log untouched:** `appendAuditEvent` writes a separate `.audit.jsonl` and **no** `.json` summary; T3 asserts the byte `.events.jsonl` is never created; the existing `store.test.ts` is not edited. (Spec §3, §5.)
- **Window correctness:** `summarizeAudit` takes an injected `now`; T2 pins it and asserts a 6-days-ago event is in and an 8-days-ago event is out of the `week` window. CLI/MCP default `window` to `session` when a session id is present else `all`. (Spec §4c, §8.)
- **Closed-enum-at-boundary (Phase 5/6/7 lesson):** `--window` validated via `auditWindowSchema.safeParse` with `(session | week | all)` hint + exit 1 (T9/T10); MCP `window` same (T6); `export --format` validated `!== "json"` with `(json)` hint + exit 1 (T10). Never a raw zod dump.
- **Type/name consistency:** `AuditEvent`/`AuditSummary`/`AuditWindow`/`SummarizeAuditOptions`, `summarizeAudit`, `appendAuditEvent`, `readAuditEvents` are identical across stats source, stats barrel, core re-export, MCP handler, and all four CLI commands. `formatAuditCards` is the single shared renderer used by report/last/session. The MCP handler is `handleAuditTokenUsage` across file, server import, dispatch, e2e. `Session.startedAt` (not `createdAt`) is used for "newest session" in `audit last` (T10) — verified against `packages/core/src/session.ts`.
- **MCP count:** exactly +1 (`audit_token_usage`), 23 → 24; read-only, no `record_audit_event` wire tool (spec §7c). Enum stays closed + alphabetic; `audit_token_usage` sorts FIRST (before `build_task_plan`) in `tool-name.ts`, `TOOL_DEFS`, the `test-d` tuple (T7), and the e2e count (T8).
- **CLI surface:** `mega audit report | last | session | export`; roadmap `mega audit`/`audit report` → `report`; `audit last`/`audit session <id>`/`audit export --format json` map 1:1; `report`/`last`/`session` also accept `--json` for consistency. Registered first in `main.ts` subCommands (T10).
- **No placeholders:** every code step is complete and runnable. The one intentional placeholder line in `export.ts` (Step 3c) is explicitly flagged for deletion with the reason, so it cannot ship. The T9 happy-path stdout assertion is described in prose because it depends on the suite's existing project-seeding helper (named differently across CLI suites); the bad-window/bad-format boundary tests are fully coded and need no seeding.
- **Task count:** 12 tasks, each a TDD cycle with a commit. Suggested batching for subagent-driven execution: **Batch A (stats core) T1–T4**, **Batch B (core re-export) T5**, **Batch C (MCP) T6–T8**, **Batch D (CLI) T9–T10**, **Batch E (emission + gate) T11–T12**. T1–T3 are independent units (event/summary/store) but T2 imports T1's type and T3 imports T1's schema, so run sequentially; T4 depends on T1–T3; T5 depends on T4 (built stats); T6–T8 depend on T5 (built core); T9–T10 depend on T5 (built core) and are independent of the MCP batch (could run in parallel with C); T11 depends on T5; T12 depends on all.
