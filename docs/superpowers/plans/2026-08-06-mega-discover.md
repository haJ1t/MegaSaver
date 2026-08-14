# Mega Discover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega discover [--json]` — an honest missed-savings finder: scan the already-persisted PreToolUse hook log and saver events for tool outputs that bypassed the saver, report their MEASURED byte sizes as "unfiltered exposure" grouped by cause (each with its exact remediation command or an explicit null), plus a windowed origin-split mediated context and an opt-in top-3 nudge on `mega hooks install`. Never a counterfactual "you would have saved X" claim (spec: `docs/superpowers/specs/2026-08-06-mega-discover-design.md`; anti-pattern: `rtk gain`, `wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §2/§5).

**Architecture:** Pure scanner in `@megasaver/stats` (`parseHookLogRows`, `scanExposure` with the windowed origin-split mediated fold) with ALL IO injected; the events-file READ is a stats-owned store reader (`readWorkspaceOverlayEvents`, the `readWorkspaceTokenSaverTotals` precedent); core re-exports everything (§3c — apps/cli never imports stats directly); a thin Citty command in apps/cli supplies fs/activation/floor/coverage callbacks from existing authorities (`minBytesFor` + new `isSaverCoveredTool` in `hooks/saver.ts`, `resolveWorkspaceTokenSaverSettings` in `@megasaver/context-gate`, `HOOK_LOG_RELATIVE_PATH` in `hooks/logger.ts`); one opt-in flag on the install command. Read-only end to end.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Biome, Citty. Reused seams: `ingestHookLog` precedent + `tokensFromBytes` (`@megasaver/stats`), `readOverlayEvents`/`overlayEventsPath` + `assertSafeSegment` (`packages/stats/src/store.ts:709,212,596`), `overlayTokenSaverEventSchema` (`packages/stats/src/event.ts:72`, `origin` field LD8), `minBytesFor` (`apps/cli/src/hooks/saver.ts:64`), private `resolveSourceKind` (`saver.ts:39`), `resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps` (`@megasaver/context-gate`), `resolveStorePath`/`readStoreEnv` (`apps/cli/src/store.ts`), cli-test-pattern (`wiki/workflows/cli-test-pattern.md`).

## Global Constraints

- **Honest-metrics hard rule.** A byte figure is measured (fs `stat` at scan time with an `isFile()` guard, or a recorded event field) or it is ABSENT — an unmeasured call is a count, never a byte estimate. Token figures come only from `tokensFromBytes(measuredBytes)` and every render labels them `(est.`. NO dollar output anywhere: the report/JSON have no price field, and a test asserts it structurally.
- **File measurement is `stat.isFile()`-gated.** Directory `filePath`s (Grep/Glob/LS `path`) and failed stats are unmeasured — a directory size is never a proxy for output size.
- **Read-only.** No new capture, no new hook fields, no writes from the scanner or the command. The §13.4 hook contracts are untouched — `mega discover` is a normal command (exit 0/1), not a hook.
- **Dependency graph.** `@megasaver/stats` gains no new deps. apps/cli consumes the new scanner symbols via `@megasaver/core` only (`apps/cli/test/dependency-graph.test.ts` must stay green); direct `@megasaver/context-gate` imports for activation follow the `hooks/status.ts` precedent.
- **Single floor/coverage authority.** Floors come from `minBytesFor` (already exported) and coverage from a new one-line `isSaverCoveredTool` wrapper in `hooks/saver.ts` — never a duplicated table.
- **Ledger context is windowed and origin-split.** Mediated folds count events whose `createdAt` epoch falls inside the hook log's observed `[from, to]` epoch window; `origin === "exec-rewrite"` → execRewrite fold, absent → postToolUse. No window (no valid row timestamps) → both folds null. Unparsable `createdAt` rows are skipped. Timestamp comparison is epoch-based (`Date.parse`), never lexicographic (offsets may differ).
- **No timing-tight tests.** All new logic is pure or mkdtemp-isolated; no wall-clock assertions, no sleeps.
- TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM `.js` specifiers, `process.env` bracket access with the standard `biome-ignore` where needed.

## File Structure

| File | Responsibility |
|---|---|
| `packages/stats/src/discover.ts` (create) | `hookLogRowSchema`, `HookLogRow`, `parseHookLogRows`, `MediatedEvent`, `MediatedFold`, `ExposureCause/Group/ScanInput/Report`, `scanExposure`, `TopFile`, `DISCOVER_HOOK_MISSING_HINT`, caveat constants |
| `packages/stats/src/store.ts` (modify) | `readWorkspaceOverlayEvents` (readdir + lenient per-session fold) |
| `packages/stats/src/index.ts` (modify) | Export discover.js + store helper |
| `packages/core/src/context-gate.ts` (modify) | Re-export the new stats symbols (existing stats blocks) |
| `apps/cli/src/hooks/saver.ts` (modify) | Export `isSaverCoveredTool` (wraps private `resolveSourceKind`) |
| `apps/cli/src/commands/discover.ts` (create) | `runDiscover`, `collectExposureReport`, `toDiscoverJson`, `renderReport`, `buildExposureNudgeLines`, `discoverCommand` |
| `apps/cli/src/main.ts` (modify) | Register `discover` subcommand |
| `apps/cli/src/commands/hooks/install.ts` (modify) | `--discover` opt-in nudge (best-effort) |
| `.changeset/mega-discover.md` (create) | minor: cli, core, stats |

---

### Task 1: Hook-log row parser in stats

**Files:**
- Create: `packages/stats/src/discover.ts`
- Create: `packages/stats/test/discover.test.ts`

**Interfaces:**
- Produces: `hookLogRowSchema`, `type HookLogRow`, `parseHookLogRows(content: string): HookLogRow[]`.
- Contract: lenient per-line parse of the log written by `apps/cli/src/hooks/logger.ts` (`{timestamp, agent, tool, category, filePath?, sessionId?}`; `agent` carried, not gated — optional). Blank/malformed/partial-tail lines skipped, mirroring `ingestHookLog` (`packages/stats/src/metrics.ts:85`).

- [ ] **Step 1: Write the failing test**

Create `packages/stats/test/discover.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHookLogRows } from "../src/discover.js";

const LINE = JSON.stringify({
  timestamp: "2026-08-13T10:00:00.000Z",
  agent: "claude-code",
  tool: "Read",
  category: "eligible_read",
  filePath: "/repo/src/big.ts",
  sessionId: "9e0d2f4a-1111-4111-8111-111111111111",
});

describe("parseHookLogRows", () => {
  it("parses valid lines and keeps optional fields", () => {
    const rows = parseHookLogRows(`${LINE}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool).toBe("Read");
    expect(rows[0]?.agent).toBe("claude-code");
    expect(rows[0]?.filePath).toBe("/repo/src/big.ts");
  });

  it("tolerates rows without filePath/sessionId/agent (Bash, old lines)", () => {
    const bash = JSON.stringify({
      timestamp: "2026-08-13T10:00:01.000Z",
      tool: "Bash",
      category: "eligible_command",
    });
    const rows = parseHookLogRows(`${bash}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filePath).toBeUndefined();
    expect(rows[0]?.agent).toBeUndefined();
  });

  it("skips blank, malformed, and partial-tail lines", () => {
    const rows = parseHookLogRows(`\n${LINE}\nnot-json\n{"timestamp": "2026-`);
    expect(rows).toHaveLength(1);
  });

  it("skips rows missing required fields", () => {
    const noTool = JSON.stringify({ timestamp: "t", agent: "claude-code", category: "c" });
    expect(parseHookLogRows(`${noTool}\n`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/stats exec vitest run test/discover.test.ts` fails (module not found).
- [ ] **Step 3: Implement**

Create `packages/stats/src/discover.ts`:

```typescript
import { z } from "zod";

// Reader for the PreToolUse telemetry log written by the CLI hook
// (apps/cli/src/hooks/logger.ts). Same lenient JSONL discipline as
// ingestHookLog: a corrupt or partially-written line is skipped, never fatal.
// `agent` is carried, not gated — the log is single-agent in practice.
export const hookLogRowSchema = z.object({
  timestamp: z.string(),
  tool: z.string(),
  category: z.string(),
  agent: z.string().optional(),
  filePath: z.string().optional(),
  sessionId: z.string().optional(),
});

export type HookLogRow = z.infer<typeof hookLogRowSchema>;

export function parseHookLogRows(content: string): HookLogRow[] {
  const rows: HookLogRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = hookLogRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}
```

- [ ] **Step 4: GREEN** — same vitest command passes; `pnpm --filter @megasaver/stats typecheck` clean.
- [ ] **Step 5: Commit** — `feat(stats): parse hook telemetry rows`

---

### Task 2: Exposure scanner (pure classifier + mediated fold)

**Files:**
- Modify: `packages/stats/src/discover.ts`
- Modify: `packages/stats/test/discover.test.ts`

**Interfaces:**
- Produces: `type ExposureCause`, `type ExposureGroup`, `type ExposureScanInput`, `type ExposureReport`, `type TopFile`, `type MediatedEvent`, `type MediatedFold`, `scanExposure(input): ExposureReport`, `DISCOVER_HOOK_MISSING_HINT`, `COMMAND_UNMEASURED_CAVEAT`, `BELOW_FLOOR_CAVEAT`.
- Classification (spec Locked Decision 3), enabled workspace, per row: `!coveredTool(tool)` → `source_uncovered`; `category === "eligible_mcp"` → `mcp_unproxied` (count-only); `category === "eligible_command"` → `command_unmeasured` (count-only, remediation null, caveat); file-backed with `sizeOf(filePath)` defined and `<= floorFor(tool)` → `below_floor` (measured, top-5 rollup); file-backed above floor → `aboveFloor` informational (measured, not exposure); read/search row with no measurable size → report-level `unmeasuredCalls` (never a group, never bytes). Disabled/null activation: every row → `workspace_disabled` with the same measured/unmeasured split inside the group. `hookLogPresent === false` → empty groups + hint. Window `{from, to}` from min/max VALID row timestamps (raw strings kept for display; epoch for comparisons). Mediated folds: events within the epoch window split by origin; no window → both null.

- [ ] **Step 1: Write the failing test**

Append to `packages/stats/test/discover.test.ts`:

```typescript
import { tokensFromBytes } from "../src/honest-metrics.js";
import {
  COMMAND_UNMEASURED_CAVEAT,
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureScanInput,
  type HookLogRow,
  type MediatedEvent,
  scanExposure,
} from "../src/discover.js";

const row = (over: Partial<HookLogRow> = {}): HookLogRow => ({
  timestamp: "2026-08-13T10:00:00.000Z",
  tool: "Read",
  category: "eligible_read",
  ...over,
});

const event = (over: Partial<MediatedEvent> = {}): MediatedEvent => ({
  createdAt: "2026-08-13T10:00:00.000Z",
  rawBytes: 100,
  returnedBytes: 10,
  ...over,
});

const baseInput = (over: Partial<ExposureScanInput> = {}): ExposureScanInput => ({
  hookLogPresent: true,
  rows: [],
  activation: { enabled: true, mode: "safe" },
  floorFor: () => 32_000,
  coveredTool: () => true,
  sizeOf: () => undefined,
  mediatedEvents: [],
  ...over,
});

describe("scanExposure", () => {
  it("missing hook log -> no groups, no numbers, install hint", () => {
    const report = scanExposure(baseInput({ hookLogPresent: false }));
    expect(report.groups).toHaveLength(0);
    expect(report.aboveFloor).toBeNull();
    expect(report.mediated).toEqual({ execRewrite: null, postToolUse: null });
    expect(report.hint).toBe(DISCOVER_HOOK_MISSING_HINT);
  });

  it("disabled workspace: every row is exposure, measured/unmeasured split inside the group", () => {
    const rows = [
      row({ filePath: "/repo/a.ts" }),
      row({ tool: "Bash", category: "eligible_command" }),
    ];
    const report = scanExposure(
      baseInput({
        rows,
        activation: null,
        sizeOf: (p) => (p === "/repo/a.ts" ? 5_000 : undefined),
      }),
    );
    expect(report.groups).toHaveLength(1);
    const g = report.groups[0];
    expect(g?.cause).toBe("workspace_disabled");
    expect(g?.calls).toBe(2);
    expect(g?.measuredBytes).toBe(5_000);
    expect(g?.unmeasuredCalls).toBe(1);
    expect(g?.remediation).toBe("mega session saver workspace enable");
    expect(g?.estTokens).toBe(tokensFromBytes(5_000));
  });

  it("below-floor is boundary-exact: size == floor is exposure, floor+1 is aboveFloor", () => {
    const rows = [row({ filePath: "/repo/eq.ts" }), row({ filePath: "/repo/over.ts" })];
    const sizes: Record<string, number> = { "/repo/eq.ts": 32_000, "/repo/over.ts": 32_001 };
    const report = scanExposure(baseInput({ rows, sizeOf: (p) => sizes[p] }));
    const g = report.groups.find((x) => x.cause === "below_floor");
    expect(g?.calls).toBe(1);
    expect(g?.measuredBytes).toBe(32_000);
    expect(g?.caveat).toContain("A4");
    expect(report.aboveFloor).toEqual({ calls: 1, measuredBytes: 32_001 });
  });

  it("uncovered tools and eligible_mcp group separately; both count-only", () => {
    const rows = [
      row({ tool: "FutureTool", category: "eligible_read" }),
      row({ tool: "mcp__github__search", category: "eligible_mcp" }),
    ];
    const report = scanExposure(baseInput({ rows, coveredTool: (t) => t !== "FutureTool" }));
    expect(report.groups.map((g) => g.cause).sort()).toEqual([
      "mcp_unproxied",
      "source_uncovered",
    ]);
    const mcp = report.groups.find((g) => g.cause === "mcp_unproxied");
    expect(mcp?.measuredBytes).toBe(0);
    expect(mcp?.remediation).toBe("mega mcp install");
    const unc = report.groups.find((g) => g.cause === "source_uncovered");
    expect(unc?.remediation).toContain("coverage gap");
  });

  it("command rows are command_unmeasured: count-only, null remediation, caveat", () => {
    const rows = [
      row({ tool: "Bash", category: "eligible_command" }),
      row({ tool: "Task", category: "eligible_command" }),
    ];
    const report = scanExposure(baseInput({ rows }));
    const g = report.groups.find((x) => x.cause === "command_unmeasured");
    expect(g?.calls).toBe(2);
    expect(g?.measuredBytes).toBe(0);
    expect(g?.remediation).toBeNull();
    expect(g?.caveat).toBe(COMMAND_UNMEASURED_CAVEAT);
  });

  it("unmeasurable read rows in an enabled workspace land in report.unmeasuredCalls, no group", () => {
    const rows = [row({ filePath: "/repo/dir" }), row({})];
    const report = scanExposure(baseInput({ rows, sizeOf: () => undefined }));
    expect(report.groups).toHaveLength(0);
    expect(report.unmeasuredCalls).toBe(2);
  });

  it("topFiles rollup: repeated reads count per call, sorted, capped at 5", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      i < 3
        ? row({ filePath: "/repo/hot.ts" })
        : row({ filePath: `/repo/cold${i}.ts` }),
    );
    const report = scanExposure(baseInput({ rows, sizeOf: (p) => (p === "/repo/hot.ts" ? 8_000 : 100) }));
    const g = report.groups.find((x) => x.cause === "below_floor");
    expect(g?.uniqueFiles).toBe(6);
    expect(g?.topFiles[0]).toEqual({ filePath: "/repo/hot.ts", calls: 3, measuredBytes: 24_000 });
    expect(g?.topFiles).toHaveLength(5);
    expect(g?.calls).toBe(8);
    expect(g?.measuredBytes).toBe(24_000 + 5 * 100);
  });

  it("window spans min/max valid row timestamps; invalid timestamps count but never define the window", () => {
    const rows = [
      row({ timestamp: "2026-08-01T00:00:00.000Z" }),
      row({ timestamp: "not-a-date", filePath: "/repo/a.ts" }),
      row({ timestamp: "2026-08-13T00:00:00.000Z" }),
    ];
    const report = scanExposure(baseInput({ rows, sizeOf: () => 1_000 }));
    expect(report.window).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-13T00:00:00.000Z",
    });
    expect(report.groups[0]?.calls).toBe(2);
  });

  it("mediated fold: windowed, origin-split, corrupt dates skipped", () => {
    const rows = [
      row({ timestamp: "2026-08-13T10:00:00.000Z" }),
      row({ timestamp: "2026-08-13T12:00:00.000Z" }),
    ];
    const events = [
      event({ createdAt: "2026-08-13T11:00:00.000Z", rawBytes: 100, returnedBytes: 10 }),
      event({ createdAt: "2026-08-13T11:00:00.000Z", rawBytes: 200, returnedBytes: 20, origin: "exec-rewrite" }),
      event({ createdAt: "2026-08-13T09:00:00.000Z", rawBytes: 999, returnedBytes: 99 }),
      event({ createdAt: "garbage", rawBytes: 888, returnedBytes: 88 }),
    ];
    const report = scanExposure(baseInput({ rows, sizeOf: () => 1_000, mediatedEvents: events }));
    expect(report.mediated).toEqual({
      postToolUse: { calls: 1, rawBytes: 100, returnedBytes: 10 },
      execRewrite: { calls: 1, rawBytes: 200, returnedBytes: 20 },
    });
  });

  it("no valid window -> both mediated folds null", () => {
    const report = scanExposure(
      baseInput({
        rows: [row({ timestamp: "junk" })],
        sizeOf: () => 1_000,
        mediatedEvents: [event()],
      }),
    );
    expect(report.window).toBeNull();
    expect(report.mediated).toEqual({ execRewrite: null, postToolUse: null });
  });

  it("groups sort by measuredBytes desc, then calls desc", () => {
    const rows = [
      row({ filePath: "/repo/small.ts" }),
      row({ tool: "Bash", category: "eligible_command" }),
    ];
    const report = scanExposure(
      baseInput({ rows, sizeOf: (p) => (p === "/repo/small.ts" ? 100 : undefined) }),
    );
    expect(report.groups[0]?.cause).toBe("below_floor");
  });

  it("honesty invariants: no price fields, tokens derived only from measured bytes", () => {
    const report = scanExposure(
      baseInput({ rows: [row({ filePath: "/repo/a.ts" })], sizeOf: () => 1_000 }),
    );
    expect(JSON.stringify(report)).not.toMatch(/usd|dollar|price|\$/i);
    for (const g of report.groups) expect(g.estTokens).toBe(tokensFromBytes(g.measuredBytes));
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/stats exec vitest run test/discover.test.ts`.
- [ ] **Step 3: Implement**

Append to `packages/stats/src/discover.ts`:

```typescript
import type { TokenSaverMode } from "@megasaver/shared";
import { tokensFromBytes } from "./honest-metrics.js";

export type ExposureCause =
  | "workspace_disabled"
  | "source_uncovered"
  | "mcp_unproxied"
  | "below_floor"
  | "command_unmeasured";

export type TopFile = { filePath: string; calls: number; measuredBytes: number };

export type ExposureGroup = {
  cause: ExposureCause;
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  estTokens: number;
  unmeasuredCalls: number;
  uniqueFiles: number;
  topFiles: TopFile[];
  remediation: string | null;
  caveat: string | null;
};

// Minimal event view: the fields the windowed fold needs. origin absent =
// PostToolUse (and every pre-wave-2 row); "exec-rewrite" = LD8.
export type MediatedEvent = {
  createdAt: string;
  rawBytes: number;
  returnedBytes: number;
  origin?: "exec-rewrite";
};

export type MediatedFold = { calls: number; rawBytes: number; returnedBytes: number };

export type ExposureScanInput = {
  hookLogPresent: boolean;
  rows: readonly HookLogRow[];
  activation: { enabled: boolean; mode: TokenSaverMode } | null;
  floorFor: (tool: string) => number;
  coveredTool: (tool: string) => boolean;
  sizeOf: (filePath: string) => number | undefined;
  mediatedEvents: readonly MediatedEvent[];
};

export type ExposureReport = {
  hookLogPresent: boolean;
  saverEnabled: boolean;
  mode: TokenSaverMode | null;
  window: { from: string; to: string } | null;
  groups: ExposureGroup[];
  aboveFloor: { calls: number; measuredBytes: number } | null;
  unmeasuredCalls: number;
  mediated: { execRewrite: MediatedFold | null; postToolUse: MediatedFold | null };
  hint: string | null;
};

// Mirrors HOOK_MISSING_HINT discipline (metrics.ts): absent evidence yields
// an install suggestion, never a fabricated number.
export const DISCOVER_HOOK_MISSING_HINT =
  "No hook telemetry found. Exposure cannot be measured. Run: mega hooks install claude-code";

export const COMMAND_UNMEASURED_CAVEAT =
  "hook log is metadata-only — rewritten (exec-rewrite covered) and bypassed command calls are indistinguishable per row; the mediated lines carry the rewrite evidence. Levers: widen the exec-rewrite allowlist, or enable a smaller floor mode.";

export const BELOW_FLOOR_CAVEAT =
  "smaller floors mean more rewrites; the billed net effect is unmeasured (A4 open) — this is a coverage fact, not a savings promise.";

const NEXT_SMALLER_MODE: Record<TokenSaverMode, TokenSaverMode | null> = {
  safe: "balanced",
  balanced: "aggressive",
  aggressive: null,
};

function remediationFor(cause: ExposureCause, mode: TokenSaverMode | null): string | null {
  switch (cause) {
    case "workspace_disabled":
      return "mega session saver workspace enable";
    case "source_uncovered":
      return "none — Mega Saver coverage gap (report the tool name upstream)";
    case "mcp_unproxied":
      return "mega mcp install";
    case "command_unmeasured":
      return null;
    case "below_floor": {
      const next = mode === null ? null : NEXT_SMALLER_MODE[mode];
      return next === null
        ? "already at the smallest floor (aggressive)"
        : `mega session saver workspace enable --mode ${next}`;
    }
  }
}

function caveatFor(cause: ExposureCause): string | null {
  if (cause === "below_floor") return BELOW_FLOOR_CAVEAT;
  if (cause === "command_unmeasured") return COMMAND_UNMEASURED_CAVEAT;
  return null;
}

type MutableGroup = {
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  unmeasuredCalls: number;
  files: Map<string, { calls: number; measuredBytes: number }>;
};

const MAX_TOP_FILES = 5;

export function scanExposure(input: ExposureScanInput): ExposureReport {
  const enabled = input.activation !== null && input.activation.enabled;
  const mode = enabled && input.activation !== null ? input.activation.mode : null;
  const empty = (): MutableGroup => ({
    calls: 0,
    measuredCalls: 0,
    measuredBytes: 0,
    unmeasuredCalls: 0,
    files: new Map(),
  });
  const groups = new Map<ExposureCause, MutableGroup>();
  let unmeasuredCalls = 0;
  let windowFromEpoch: number | null = null;
  let windowToEpoch: number | null = null;
  let fromRaw: string | null = null;
  let toRaw: string | null = null;
  let aboveFloorCalls = 0;
  let aboveFloorBytes = 0;

  const add = (cause: ExposureCause, r: HookLogRow, size: number | undefined): void => {
    const g = groups.get(cause) ?? empty();
    g.calls += 1;
    if (size === undefined) {
      g.unmeasuredCalls += 1;
    } else {
      g.measuredCalls += 1;
      g.measuredBytes += size;
      if (r.filePath !== undefined) {
        const f = g.files.get(r.filePath) ?? { calls: 0, measuredBytes: 0 };
        f.calls += 1;
        f.measuredBytes += size;
        g.files.set(r.filePath, f);
      }
    }
    groups.set(cause, g);
  };

  if (input.hookLogPresent) {
    for (const r of input.rows) {
      // Epoch comparison, never lexicographic: event offsets may differ.
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) {
        if (windowFromEpoch === null || t < windowFromEpoch) {
          windowFromEpoch = t;
          fromRaw = r.timestamp;
        }
        if (windowToEpoch === null || t > windowToEpoch) {
          windowToEpoch = t;
          toRaw = r.timestamp;
        }
      }
      const size = r.filePath === undefined ? undefined : input.sizeOf(r.filePath);
      if (!enabled) {
        add("workspace_disabled", r, size);
        continue;
      }
      if (!input.coveredTool(r.tool)) {
        add("source_uncovered", r, size);
        continue;
      }
      if (r.category === "eligible_mcp") {
        add("mcp_unproxied", r, undefined);
        continue;
      }
      if (r.category === "eligible_command") {
        add("command_unmeasured", r, undefined);
        continue;
      }
      if (size !== undefined) {
        if (size <= input.floorFor(r.tool)) add("below_floor", r, size);
        else {
          aboveFloorCalls += 1;
          aboveFloorBytes += size;
        }
        continue;
      }
      unmeasuredCalls += 1;
    }
  }

  const finalized: ExposureGroup[] = [...groups.entries()]
    .map(([cause, g]) => ({
      cause,
      calls: g.calls,
      measuredCalls: g.measuredCalls,
      measuredBytes: g.measuredBytes,
      estTokens: tokensFromBytes(g.measuredBytes),
      unmeasuredCalls: g.unmeasuredCalls,
      uniqueFiles: g.files.size,
      topFiles: [...g.files.entries()]
        .map(([filePath, f]) => ({ filePath, calls: f.calls, measuredBytes: f.measuredBytes }))
        .sort(
          (a, b) =>
            b.measuredBytes - a.measuredBytes || b.calls - a.calls || a.filePath.localeCompare(b.filePath),
        )
        .slice(0, MAX_TOP_FILES),
      remediation: remediationFor(cause, mode),
      caveat: caveatFor(cause),
    }))
    .sort(
      (a, b) => b.measuredBytes - a.measuredBytes || b.calls - a.calls || a.cause.localeCompare(b.cause),
    );

  const fold = (origin: "exec-rewrite" | "postToolUse"): MediatedFold | null => {
    if (windowFromEpoch === null || windowToEpoch === null) return null;
    let calls = 0;
    let rawBytes = 0;
    let returnedBytes = 0;
    for (const e of input.mediatedEvents) {
      if (origin === "exec-rewrite" ? e.origin !== "exec-rewrite" : e.origin === "exec-rewrite") {
        continue;
      }
      const t = Date.parse(e.createdAt);
      if (Number.isNaN(t) || t < windowFromEpoch || t > windowToEpoch) continue;
      calls += 1;
      rawBytes += e.rawBytes;
      returnedBytes += e.returnedBytes;
    }
    return calls === 0 ? null : { calls, rawBytes, returnedBytes };
  };

  return {
    hookLogPresent: input.hookLogPresent,
    saverEnabled: enabled,
    mode,
    window: fromRaw !== null && toRaw !== null ? { from: fromRaw, to: toRaw } : null,
    groups: finalized,
    aboveFloor: aboveFloorCalls === 0 ? null : { calls: aboveFloorCalls, measuredBytes: aboveFloorBytes },
    unmeasuredCalls,
    mediated: { execRewrite: fold("exec-rewrite"), postToolUse: fold("postToolUse") },
    hint: input.hookLogPresent ? null : DISCOVER_HOOK_MISSING_HINT,
  };
}
```

- [ ] **Step 4: GREEN** — vitest run passes; `pnpm --filter @megasaver/stats typecheck` clean; `pnpm exec biome check packages/stats` clean.
- [ ] **Step 5: Commit** — `feat(stats): exposure scanner groups bypass causes`

---

### Task 3: Store reader + public surface (stats index + core re-export)

**Files:**
- Modify: `packages/stats/src/store.ts`
- Create: `packages/stats/test/discover-store.test.ts`
- Modify: `packages/stats/src/index.ts`
- Modify: `packages/core/src/context-gate.ts`
- Modify: `packages/stats/test/discover.test.ts`

**Interfaces:**
- Produces: `readWorkspaceOverlayEvents(store: StatsStore, workspaceKey: string): OverlayTokenSaverEvent[]` — readdir `stats/<workspaceKey>`, for each `*.events.jsonl` fold via the existing `readOverlayEvents` (`store.ts:709`); missing dir → `[]`; `assertSafeSegment(workspaceKey)` guard like `readWorkspaceTokenSaverTotals` (`store.ts:596`).
- Public surface: `parseHookLogRows`, `scanExposure`, `hookLogRowSchema`, `DISCOVER_HOOK_MISSING_HINT`, `COMMAND_UNMEASURED_CAVEAT`, `BELOW_FLOOR_CAVEAT`, `readWorkspaceOverlayEvents`, and the discover types exported from `@megasaver/stats`; re-exported from `@megasaver/core` in `packages/core/src/context-gate.ts` following its existing stats blocks (lines 33-55 pattern, where `ingestHookLog`/`buildProxyMetrics` already live).

- [ ] **Step 1: Write the failing tests**

Create `packages/stats/test/discover-store.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceOverlayEvents } from "../src/store.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-discover-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventLine = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    liveSessionId: "sess1",
    workspaceKey: "wk1",
    createdAt: "2026-08-13T10:00:00.000Z",
    sourceKind: "command",
    label: "ls",
    rawBytes: 100,
    returnedBytes: 10,
    bytesSaved: 90,
    savingRatio: 0.9,
    summary: "",
    ...over,
  });

describe("readWorkspaceOverlayEvents", () => {
  it("folds all session event files, skipping corrupt lines and non-event files", () => {
    const dir = join(root, "stats", "wk1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sess1.events.jsonl"),
      `${eventLine("e1")}\nnot-json\n${eventLine("e2", { origin: "exec-rewrite" })}\n`,
    );
    writeFileSync(join(dir, "sess2.events.jsonl"), `${eventLine("e3")}\n`);
    writeFileSync(join(dir, "sess1.json"), JSON.stringify({ junk: true }));

    const events = readWorkspaceOverlayEvents({ root }, "wk1");
    expect(events.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(events.find((e) => e.id === "e2")?.origin).toBe("exec-rewrite");
  });

  it("missing workspace dir -> empty list", () => {
    expect(readWorkspaceOverlayEvents({ root }, "nope")).toEqual([]);
  });
});
```

Append to `packages/stats/test/discover.test.ts`:

```typescript
import * as statsIndex from "../src/index.js";

describe("discover public surface", () => {
  it("exports the scanner and the store reader through the package index", () => {
    expect(typeof statsIndex.parseHookLogRows).toBe("function");
    expect(typeof statsIndex.scanExposure).toBe("function");
    expect(typeof statsIndex.readWorkspaceOverlayEvents).toBe("function");
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/stats exec vitest run test/discover-store.test.ts test/discover.test.ts`.
- [ ] **Step 3: Implement** — append to `packages/stats/src/store.ts`:

```typescript
// Discover context reader: every session's event rows for a workspace, folded
// across files. Lenient per line (readOverlayEvents skips corrupt rows); a
// missing workspace dir is simply no events.
export function readWorkspaceOverlayEvents(
  store: StatsStore,
  workspaceKey: string,
): OverlayTokenSaverEvent[] {
  assertSafeSegment(workspaceKey);
  let entries: string[];
  try {
    entries = readdirSync(join(store.root, "stats", workspaceKey));
  } catch {
    return [];
  }
  const events: OverlayTokenSaverEvent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".events.jsonl")) continue;
    const liveSessionId = entry.slice(0, -".events.jsonl".length);
    events.push(...readOverlayEvents(store, workspaceKey, liveSessionId));
  }
  return events;
}
```

Add to `packages/stats/src/index.ts`:

```typescript
export {
  BELOW_FLOOR_CAVEAT,
  COMMAND_UNMEASURED_CAVEAT,
  DISCOVER_HOOK_MISSING_HINT,
  hookLogRowSchema,
  parseHookLogRows,
  scanExposure,
  type ExposureCause,
  type ExposureGroup,
  type ExposureReport,
  type ExposureScanInput,
  type HookLogRow,
  type MediatedEvent,
  type MediatedFold,
  type TopFile,
} from "./discover.js";

export { readWorkspaceOverlayEvents } from "./store.js";
```

Add to `packages/core/src/context-gate.ts` (after the existing stats blocks):

```typescript
export {
  BELOW_FLOOR_CAVEAT,
  COMMAND_UNMEASURED_CAVEAT,
  DISCOVER_HOOK_MISSING_HINT,
  hookLogRowSchema,
  parseHookLogRows,
  scanExposure,
  type ExposureCause,
  type ExposureGroup,
  type ExposureReport,
  type ExposureScanInput,
  type HookLogRow,
  type MediatedEvent,
  type MediatedFold,
  type TopFile,
  readWorkspaceOverlayEvents,
} from "@megasaver/stats";
```

- [ ] **Step 4: GREEN** — stats vitest passes; `pnpm --filter @megasaver/core typecheck` proves the re-export resolves; `pnpm --filter @megasaver/stats typecheck` clean.
- [ ] **Step 5: Commit** — `feat(stats): readWorkspaceOverlayEvents + discover public surface`

---

### Task 4: `mega discover` command

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (one exported wrapper)
- Create: `apps/cli/src/commands/discover.ts`
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/test/discover.test.ts`
- Modify: `apps/cli/test/hooks/saver.test.ts` (wrapper test)

**Interfaces:**
- Produces: `isSaverCoveredTool(tool: string): boolean` (saver.ts); `RunDiscoverInput`, `runDiscover(input): Promise<0 | 1>`, `CollectExposureInput`, `collectExposureReport(input): ExposureReport`, `toDiscoverJson(report, now?)`, `renderReport(report)`, `discoverCommand` (discover.ts; `buildExposureNudgeLines` arrives in Task 5).
- `RunDiscoverInput` follows `RunHooksStatusInput` (`hooks/status.ts`): store slice + `hookLogPath?` override + injectable `resolveActivation?` + `now?: () => string` (JSON `generatedAt`) + `stdout`/`stderr`/`json`.
- Production wiring: activation via `resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps())` mapped as in `saver-run.ts`; floors via `minBytesFor(tool, mode ?? "safe")`; coverage via `isSaverCoveredTool`; sizes via `statSync` with `isFile()` guard (try/catch → `undefined`); mediated events via `readWorkspaceOverlayEvents({ root: storeRoot }, encodeWorkspaceKey(cwd))` (try/catch → `[]`); log path `join(cwd, HOOK_LOG_RELATIVE_PATH)`.
- JSON contract (spec): `{window, hookMissing, groups[{cause, calls, measuredBytes|null, uniqueFiles, topFiles, remediation|null, caveat?}], aboveFloor, mediated, generatedAt}` — `toDiscoverJson` strips renderer-only fields (`estTokens`, `measuredCalls`, `unmeasuredCalls`, `hookLogPresent`, `saverEnabled`, `mode`, `hint`, `unmeasuredCalls`), maps `measuredBytes: 0 → null` for count-only groups, and sets `hookMissing: !report.hookLogPresent` so a missing log is distinguishable from zero exposure in JSON.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/discover.test.ts` (cli-test-pattern: direct inner-function invocation, mkdtemp isolation, injected activation):

```typescript
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiscover, toDiscoverJson } from "../src/commands/discover.js";

let root: string;
let cwd: string;
let out: string[];
let err: string[];

const baseInput = () => ({
  storeFlag: root,
  cwd,
  home: root,
  xdgDataHome: undefined,
  platform: "darwin" as NodeJS.Platform,
  localAppData: undefined,
  stdout: (line: string) => out.push(line),
  stderr: (line: string) => err.push(line),
  json: false,
});

async function writeHookLog(lines: object[]): Promise<void> {
  const dir = join(cwd, ".megasaver", "hooks");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "claude-tool-calls.jsonl"),
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "megasaver-discover-store-"));
  cwd = await mkdtemp(join(tmpdir(), "megasaver-discover-cwd-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("runDiscover", () => {
  it("missing hook log -> hint, exit 0, no numbers", async () => {
    const code = await runDiscover({ ...baseInput(), resolveActivation: () => null });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("mega hooks install claude-code");
  });

  it("disabled workspace groups all calls with the enable remediation", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(2_000));
    await writeHookLog([
      { timestamp: "2026-08-13T10:00:00.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
      { timestamp: "2026-08-13T10:00:01.000Z", agent: "claude-code", tool: "Bash", category: "eligible_command" },
    ]);
    const code = await runDiscover({ ...baseInput(), resolveActivation: () => null });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("workspace disabled");
    expect(text).toContain("2,000 B measured");
    expect(text).toContain("fix: mega session saver workspace enable");
    expect(text).toContain("(est.");
  });

  it("renders top repeated reads under below_floor", async () => {
    const target = join(cwd, "hot.ts");
    await writeFile(target, "x".repeat(1_000));
    await writeHookLog([
      { timestamp: "2026-08-13T10:00:00.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
      { timestamp: "2026-08-13T10:00:01.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
    ]);
    const code = await runDiscover({
      ...baseInput(),
      resolveActivation: () => ({ enabled: true, mode: "safe" as const }),
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("hot.ts");
    expect(text).toContain("2 calls");
  });

  it("--json emits one parseable line matching the JSON contract", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(1_000));
    await writeHookLog([
      { timestamp: "2026-08-13T10:00:00.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
    ]);
    const code = await runDiscover({
      ...baseInput(),
      json: true,
      resolveActivation: () => ({ enabled: true, mode: "safe" as const }),
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0] ?? "") as Record<string, unknown>;
    expect(report.groups).toBeInstanceOf(Array);
    const g = (report.groups as Array<Record<string, unknown>>)[0];
    expect(g?.["cause"]).toBe("below_floor");
    expect(g?.["measuredBytes"]).toBe(1_000);
    expect(Object.keys(g ?? {}).sort()).toEqual([
      "calls",
      "cause",
      "caveat",
      "measuredBytes",
      "remediation",
      "topFiles",
      "uniqueFiles",
    ]);
    expect(report).not.toHaveProperty("hookLogPresent");
    expect(report).not.toHaveProperty("estTokens");
    expect(report["hookMissing"]).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/usd|dollar|price|\$/i);
    expect(typeof report["generatedAt"]).toBe("string");
  });
});

describe("toDiscoverJson", () => {
  it("missing hook log emits hookMissing true", () => {
    const report = {
      hookLogPresent: false,
      saverEnabled: false,
      mode: null,
      window: null,
      groups: [],
      aboveFloor: null,
      unmeasuredCalls: 0,
      mediated: { execRewrite: null, postToolUse: null },
      hint: "h",
    };
    const parsed = JSON.parse(toDiscoverJson(report, () => "fixed-ts")) as Record<string, unknown>;
    expect(parsed["hookMissing"]).toBe(true);
    expect(parsed).not.toHaveProperty("hint");
  });

  it("count-only groups emit measuredBytes null; now() is injectable", () => {
    const report = {
      hookLogPresent: true,
      saverEnabled: true,
      mode: "safe" as const,
      window: null,
      groups: [
        {
          cause: "command_unmeasured" as const,
          calls: 3,
          measuredCalls: 0,
          measuredBytes: 0,
          estTokens: 0,
          unmeasuredCalls: 3,
          uniqueFiles: 0,
          topFiles: [],
          remediation: null,
          caveat: "c",
        },
      ],
      aboveFloor: null,
      unmeasuredCalls: 0,
      mediated: { execRewrite: null, postToolUse: null },
      hint: null,
    };
    const parsed = JSON.parse(toDiscoverJson(report, () => "fixed-ts")) as Record<string, unknown>;
    const g = (parsed["groups"] as Array<Record<string, unknown>>)[0];
    expect(g?.["measuredBytes"]).toBeNull();
    expect(g?.["remediation"]).toBeNull();
    expect(parsed["generatedAt"]).toBe("fixed-ts");
  });
});
```

Also append a coverage-wrapper test to the existing `apps/cli/test/hooks/saver.test.ts`:

```typescript
import { isSaverCoveredTool } from "../../src/hooks/saver.js";

describe("isSaverCoveredTool", () => {
  it("covers native tools and non-mega mcp; rejects unknown and mega bridge tools", () => {
    expect(isSaverCoveredTool("Read")).toBe(true);
    expect(isSaverCoveredTool("mcp__github__search")).toBe(true);
    expect(isSaverCoveredTool("mcp__megasaver__read")).toBe(false);
    expect(isSaverCoveredTool("SomeFutureTool")).toBe(false);
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/cli exec vitest run test/discover.test.ts test/hooks/saver.test.ts`.
- [ ] **Step 3: Implement** — `isSaverCoveredTool` in `apps/cli/src/hooks/saver.ts` (next to `minBytesFor`):

```typescript
export function isSaverCoveredTool(tool: string): boolean {
  return resolveSourceKind(tool) !== undefined;
}
```

Create `apps/cli/src/commands/discover.ts`:

```typescript
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nodeResolverDeps, resolveWorkspaceTokenSaverSettings } from "@megasaver/context-gate";
import {
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureGroup,
  type ExposureReport,
  parseHookLogRows,
  readWorkspaceOverlayEvents,
  scanExposure,
} from "@megasaver/core";
import { type TokenSaverMode, encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { HOOK_LOG_RELATIVE_PATH } from "../hooks/logger.js";
import { isSaverCoveredTool, minBytesFor } from "../hooks/saver.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunDiscoverInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  hookLogPath?: string;
  resolveActivation?: (
    storeRoot: string,
    cwd: string,
  ) => { enabled: boolean; mode: TokenSaverMode } | null;
  now?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

// Unreadable log is treated as absent — adoption-only (hooks/status.ts).
function readHookLog(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// stat only, never open: a failed stat or a directory moves the call to
// unmeasured — a directory size is never a proxy for output size.
function sizeOf(filePath: string): number | undefined {
  try {
    const s = statSync(filePath);
    return s.isFile() ? s.size : undefined;
  } catch {
    return undefined;
  }
}

function defaultResolveActivation(
  storeRoot: string,
  cwd: string,
): { enabled: boolean; mode: TokenSaverMode } | null {
  const r = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
  return r.enabled ? { enabled: true, mode: r.mode } : null;
}

export type CollectExposureInput = {
  storeRoot: string;
  cwd: string;
  hookLogPath?: string;
  resolveActivation?: RunDiscoverInput["resolveActivation"];
};

// The whole scan pipeline after store resolution — shared by `mega discover`
// and the Task 5 install nudge.
export function collectExposureReport(input: CollectExposureInput): ExposureReport {
  const hookLogPath = input.hookLogPath ?? join(input.cwd, HOOK_LOG_RELATIVE_PATH);
  const content = readHookLog(hookLogPath);
  const rows = content === null ? [] : parseHookLogRows(content);
  const activation = (input.resolveActivation ?? defaultResolveActivation)(
    input.storeRoot,
    input.cwd,
  );
  const mode = activation !== null && activation.enabled ? activation.mode : null;

  let mediatedEvents: Parameters<typeof scanExposure>[0]["mediatedEvents"] = [];
  try {
    mediatedEvents = readWorkspaceOverlayEvents({ root: input.storeRoot }, encodeWorkspaceKey(input.cwd));
  } catch {
    // No stats tree yet — mediated context is simply empty.
  }

  return scanExposure({
    hookLogPresent: content !== null,
    rows,
    activation,
    floorFor: (tool) => minBytesFor(tool, mode ?? "safe"),
    coveredTool: isSaverCoveredTool,
    sizeOf,
    mediatedEvents,
  });
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// Spec JSON contract: renderer-only fields stripped; measuredBytes null for
// count-only groups. Single line.
export function toDiscoverJson(
  report: ExposureReport,
  now: () => string = () => new Date().toISOString(),
): string {
  const group = (g: ExposureGroup) => ({
    cause: g.cause,
    calls: g.calls,
    measuredBytes: g.measuredCalls === 0 ? null : g.measuredBytes,
    uniqueFiles: g.uniqueFiles,
    topFiles: g.topFiles,
    remediation: g.remediation,
    ...(g.caveat !== null ? { caveat: g.caveat } : {}),
  });
  return JSON.stringify({
    window: report.window,
    hookMissing: !report.hookLogPresent,
    groups: report.groups.map(group),
    aboveFloor: report.aboveFloor,
    mediated: report.mediated,
    generatedAt: now(),
  });
}

function foldLine(prefix: string, fold: { calls: number; rawBytes: number; returnedBytes: number }): string {
  return `${prefix}: ${fold.calls} calls, ${fold.rawBytes} B raw -> ${fold.returnedBytes} B delivered`;
}

export function renderReport(report: ExposureReport): string[] {
  if (!report.hookLogPresent) return [report.hint ?? DISCOVER_HOOK_MISSING_HINT];
  const lines = ["Unfiltered exposure (measured bytes only — no counterfactuals):"];
  lines.push(`  saver: ${report.saverEnabled ? `enabled (${report.mode})` : "disabled"}`);
  if (report.window !== null) {
    lines.push(`  window: ${report.window.from} -> ${report.window.to}`);
  }
  for (const [i, g] of report.groups.entries()) {
    const unmeasured = g.unmeasuredCalls > 0 ? `, ${plural(g.unmeasuredCalls, "call")} unmeasured` : "";
    lines.push(
      `  ${i + 1}. ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}, ${g.measuredBytes} B measured across ${plural(g.uniqueFiles, "file")} (est. ~${g.estTokens} tokens)${unmeasured}`,
    );
    lines.push(g.remediation === null ? `     fix: none` : `     fix: ${g.remediation}`);
    if (g.caveat !== null) lines.push(`     note: ${g.caveat}`);
    if (g.topFiles.length > 0) {
      lines.push("     top repeated reads:");
      for (const f of g.topFiles) {
        lines.push(`       ${f.filePath} — ${plural(f.calls, "call")}, ${f.measuredBytes} B`);
      }
    }
  }
  if (report.groups.length === 0) lines.push("  (no exposure found)");
  if (report.aboveFloor !== null) {
    lines.push(
      `  above floor (saver-attempted, not exposure): ${plural(report.aboveFloor.calls, "call")}, ${report.aboveFloor.measuredBytes} B measured`,
    );
  }
  lines.push("  mediated in window:");
  const er = report.mediated.execRewrite;
  const pt = report.mediated.postToolUse;
  if (er === null && pt === null) {
    lines.push("    (no mediated events in the observed window)");
  } else {
    if (er !== null) lines.push(`    ${foldLine("exec-rewrite", er)}`);
    if (pt !== null) lines.push(`    ${foldLine("postToolUse", pt)}`);
  }
  if (report.unmeasuredCalls > 0) {
    lines.push(`  no size evidence: ${plural(report.unmeasuredCalls, "call")} (not estimated)`);
  }
  return lines;
}

export async function runDiscover(input: RunDiscoverInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    // The only failure path, mirroring runHooksStatus (hooks/status.ts).
    storeRoot = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const report = collectExposureReport({
    storeRoot,
    cwd: input.cwd,
    ...(input.hookLogPath !== undefined ? { hookLogPath: input.hookLogPath } : {}),
    ...(input.resolveActivation !== undefined
      ? { resolveActivation: input.resolveActivation }
      : {}),
  });

  if (input.json) {
    input.stdout(toDiscoverJson(report, input.now));
    return 0;
  }
  for (const line of renderReport(report)) input.stdout(line);
  return 0;
}

export const discoverCommand = defineCommand({
  meta: {
    name: "discover",
    description:
      "Report measured unfiltered exposure: tool outputs that bypassed the saver, grouped by cause (read-only).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    "hook-log": { type: "string", description: "Override Claude Code hook log path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runDiscover({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(typeof args["hook-log"] === "string" ? { hookLogPath: args["hook-log"] } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

`apps/cli/src/main.ts` — exact diffs (import list is alphabetical; `dejaVu` < `discover` < `doctor`):

```diff
 import { dejaVuCommand } from "./commands/deja-vu/index.js";
+import { discoverCommand } from "./commands/discover.js";
 import { doctorCommand } from "./commands/doctor.js";
```

```diff
     cache: cacheCommand,
     doctor: doctorCommand,
+    discover: discoverCommand,
     github: githubCommand,
```

- [ ] **Step 4: GREEN** — cli vitest passes; `pnpm --filter @megasaver/cli exec vitest run test/dependency-graph.test.ts` green (scanner came via `@megasaver/core`); `pnpm --filter @megasaver/cli typecheck`; `pnpm exec biome check apps/cli`.
- [ ] **Step 5: Smoke evidence (DoD #5)** — from the repo root: `pnpm --filter @megasaver/cli build && node apps/cli/dist/cli.js discover --json`; capture the terminal output into the PR description.
- [ ] **Step 6: Commit** — `feat(cli): mega discover reports exposure`

---

### Task 5: Opt-in nudge on `mega hooks install`

**Files:**
- Modify: `apps/cli/src/commands/discover.ts` (export `buildExposureNudgeLines`)
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Modify: `apps/cli/test/hooks/install.test.ts`

**Interfaces:**
- Produces: `buildExposureNudgeLines(report: ExposureReport, max = 3): string[]` — pure; one line per non-empty group: `exposure: <cause label> — <calls> calls[, <measuredBytes> B measured] (fix: <remediation> | no fix command — see mega discover)`; empty array when no groups.
- Install command gains `discover: { type: "boolean", default: false, description: ... }` and `RunHooksInstallInput` gains `discover: boolean` plus injectable `discoverLines?: () => string[]`. After a successful install (before `return 0`), when `discover` is true and not JSON: wrap `discoverLines()` in try/catch and print each line — best-effort exactly like the maintenance trigger; a failure must never affect the install result.

- [ ] **Step 1: Write the failing test** — append to `apps/cli/test/hooks/install.test.ts` (same rig as the existing `runHooksInstall` direct-invocation describes):

```typescript
describe("runHooksInstall --discover nudge", () => {
  let dir: string;
  let settingsPath: string;
  let out: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "megasaver-hook-install-discover-"));
    settingsPath = join(dir, "settings.json");
    out = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (over: Partial<Parameters<typeof runHooksInstall>[0]> = {}) =>
    runHooksInstall({
      target: "claude-code",
      settingsPath,
      stdout: (line) => out.push(line),
      stderr: () => {},
      json: false,
      ...over,
    });

  it("prints the injected exposure lines after the install output", () => {
    const code = run({ discover: true, discoverLines: () => ["exposure: a", "exposure: b"] });
    expect(code).toBe(0);
    expect(out[0]).toContain("Installed Claude Code Mega Saver hooks");
    expect(out.slice(1)).toEqual(["exposure: a", "exposure: b"]);
  });

  it("prints no exposure line without the flag (default)", () => {
    const code = run({ discoverLines: () => ["exposure: a"] });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("exposure:");
  });

  it("a throwing scan leaves install output and exit code identical", () => {
    const code = run({
      discover: true,
      discoverLines: () => {
        throw new Error("boom");
      },
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Installed Claude Code Mega Saver hooks");
  });
});
```

Also append a pure unit test to `apps/cli/test/discover.test.ts`:

```typescript
import type { ExposureReport } from "@megasaver/core";
import { buildExposureNudgeLines } from "../src/commands/discover.js";

describe("buildExposureNudgeLines", () => {
  it("formats measured and count-only groups; caps at max", () => {
    const report: ExposureReport = {
      hookLogPresent: true,
      saverEnabled: true,
      mode: "safe",
      window: null,
      groups: [
        {
          cause: "below_floor",
          calls: 4,
          measuredCalls: 4,
          measuredBytes: 2_000,
          estTokens: 500,
          unmeasuredCalls: 0,
          uniqueFiles: 1,
          topFiles: [],
          remediation: "mega session saver workspace enable --mode balanced",
          caveat: null,
        },
        {
          cause: "command_unmeasured",
          calls: 9,
          measuredCalls: 0,
          measuredBytes: 0,
          estTokens: 0,
          unmeasuredCalls: 9,
          uniqueFiles: 0,
          topFiles: [],
          remediation: null,
          caveat: null,
        },
      ],
      aboveFloor: null,
      unmeasuredCalls: 0,
      mediated: { execRewrite: null, postToolUse: null },
      hint: null,
    };
    const lines = buildExposureNudgeLines(report, 3);
    expect(lines[0]).toContain("2,000 B measured");
    expect(lines[1]).toContain("no fix command");
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts test/discover.test.ts`.
- [ ] **Step 3: Implement** — append to `apps/cli/src/commands/discover.ts`:

```typescript
export function buildExposureNudgeLines(report: ExposureReport, max = 3): string[] {
  return report.groups.slice(0, max).map((g) => {
    const size = g.measuredBytes > 0 ? `, ${g.measuredBytes} B measured` : "";
    const fix =
      g.remediation === null ? "no fix command — see mega discover" : `fix: ${g.remediation}`;
    return `exposure: ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}${size} (${fix})`;
  });
}
```

In `apps/cli/src/commands/hooks/install.ts`, extend `RunHooksInstallInput` (after `execRewrite?: boolean;`):

```typescript
  discover?: boolean;
  // Injectable for tests; production wires collectExposureReport (Task 4).
  discoverLines?: () => string[];
```

and insert before `return 0;` (after the maintenance trigger block):

```typescript
  // Opt-in exposure nudge (spec Locked Decision 9): best-effort exactly like
  // the maintenance trigger — a scan failure must never affect the install
  // result; JSON mode is unchanged (nudge is text-mode only, v1).
  if (input.discover === true && !input.json && input.discoverLines !== undefined) {
    try {
      for (const line of input.discoverLines()) input.stdout(line);
    } catch {
      // Best-effort nudge must never affect the install result.
    }
  }
  return 0;
```

Citty wiring in `hooksInstallCommand`: add the arg (after `exec-rewrite`):

```typescript
    discover: {
      type: "boolean",
      default: false,
      description:
        "Append a top-3 unfiltered-exposure summary (reads local hook telemetry only).",
    },
```

and in the `run` closure (imports: `buildExposureNudgeLines`, `collectExposureReport` from `../discover.js`):

```typescript
      discover: !!args.discover,
      discoverLines: () => {
        const env = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
        return buildExposureNudgeLines(
          collectExposureReport({ storeRoot: resolveStorePath(env), cwd: env.cwd }),
          3,
        );
      },
```

(`resolveStorePath` may throw inside the closure — the best-effort try/catch in `runHooksInstall` owns it.)

- [ ] **Step 4: GREEN** — install/discover tests pass; `pnpm --filter @megasaver/cli typecheck`; biome clean.
- [ ] **Step 5: Commit** — `feat(cli): opt-in exposure nudge on install`

---

### Task 6: Changeset, wiki, full verification, review

**Files:**
- Create: `.changeset/mega-discover.md`
- Modify: `wiki/entities/cli.md`, `wiki/entities/stats.md`, `wiki/log.md`

- [ ] **Step 1: Changeset** — minor bumps for `@megasaver/stats`, `@megasaver/core`, `@megasaver/cli`: "mega discover: honest missed-savings finder — measured unfiltered-exposure report grouped by bypass cause (workspace_disabled, source_uncovered, mcp_unproxied, below_floor with per-file rollup, command_unmeasured), windowed origin-split mediated context, --json, opt-in install nudge. Measured bytes only; token figures labeled estimates; no dollar claims."
- [ ] **Step 2: Wiki** — `entities/cli.md`: add `mega discover` + the `hooks install --discover` flag; `entities/stats.md`: add the discover scanner + `readWorkspaceOverlayEvents` to the public surface with the honest-metrics note; timestamped `log.md` entry.
- [ ] **Step 3: Full gate** — `pnpm verify` (lint + typecheck + all tests) green at branch tip; re-run the Task 4 smoke.
- [ ] **Step 4: Commit** — `docs: changeset and wiki for mega discover`
- [ ] **Step 5: Review request (DoD #6)** — dispatch `code-reviewer` in a fresh context (author ≠ reviewer; MEDIUM risk per spec).

## Verified-Symbol Ledger

`ingestHookLog`/`buildProxyMetrics`/`computeInterception`/`HOOK_MISSING_HINT` (`packages/stats/src/metrics.ts:85,146,116,132` — already re-exported by core at `packages/core/src/context-gate.ts:39-43`); `tokensFromBytes` (`packages/stats/src/honest-metrics.ts:96`); `HOOK_LOG_RELATIVE_PATH` + line shape with `agent` (`apps/cli/src/hooks/logger.ts:42,44-51`); `minBytesFor`, `NEW_SURFACE_MIN_BYTES = 16_384`, `BASH_COMPRESS_FLOOR = 24_000`, private `resolveSourceKind` (`apps/cli/src/hooks/saver.ts:64,29,37,39`); `modeToBudget` safe 32 000 / balanced 12 000 / aggressive 4 000 (`packages/shared/src/token-saver-mode.ts:15`); `resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps` (`packages/context-gate/src/resolve-saver-settings.ts:68,232`; CLI usage precedent `apps/cli/src/hooks/saver-run.ts`); `overlayTokenSaverEventSchema` with `origin` (`packages/stats/src/event.ts:72,101`); `readOverlayEvents` + `overlayEventsPath` + `assertSafeSegment` (`packages/stats/src/store.ts:709,212,596`); `encodeWorkspaceKey` (`@megasaver/shared`); enable command `mega session saver workspace enable [--mode]` (`apps/cli/src/commands/session/saver/workspace.ts`); `readStoreEnv`/`resolveStorePath` + `mapErrorToCliMessage` (`apps/cli/src/store.ts`, `apps/cli/src/errors.ts`).

Verified: `apps/cli/test/hooks/saver.test.ts` and `apps/cli/test/hooks/install.test.ts` exist, and install.test.ts already invokes `runHooksInstall` programmatically with injected inputs alongside a separate Citty-parse describe — the Task 5 tests append to that established direct-invocation pattern (both invocation styles are sanctioned by `wiki/workflows/cli-test-pattern.md`).

Verified: `mega mcp install` is the remediation command for `mcp_unproxied` — `mcpInstallCommand` carries meta name `"install"` (`apps/cli/src/commands/mcp/install.ts`) and is registered as the `install` subcommand of `mcpCommand` (`apps/cli/src/commands/mcp/index.ts`).

Verified: `apps/cli/src/main.ts` import block is alphabetical with `dejaVuCommand` (line 16) directly above `doctorCommand` (line 17) — `discoverCommand` slots between them; the commands map has `doctor: doctorCommand` at line 81 — `discover: discoverCommand` goes directly after it.
