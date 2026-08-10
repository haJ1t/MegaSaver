# Mega Discover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mega discover [--json]` — an honest missed-savings finder: scan the already-persisted PreToolUse hook log and saver events for tool outputs that bypassed the saver, report their MEASURED byte sizes as "unfiltered exposure" grouped by cause (each with its exact remediation command), plus an opt-in top-3 nudge on `mega hooks install`. Never a counterfactual "you would have saved X" claim (spec: `docs/superpowers/specs/2026-08-06-mega-discover-design.md`; anti-pattern: `rtk gain`, `wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §2/§5).

**Architecture:** Two pure functions in `@megasaver/stats` (`parseHookLogRows`, `scanExposure`) with ALL IO injected; core re-exports them (§3c — apps/cli never imports stats directly); a thin Citty command in apps/cli supplies fs/activation/floor callbacks from existing authorities (`minBytesFor` in `hooks/saver.ts`, `resolveWorkspaceTokenSaverSettings` in `@megasaver/context-gate`, `HOOK_LOG_RELATIVE_PATH` in `hooks/logger.ts`); one opt-in flag on the install command. Read-only end to end — the scanner writes nothing.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, Biome, Citty. Reused seams: `ingestHookLog` precedent + `tokensFromBytes` (`@megasaver/stats`), `readWorkspaceTokenSaverTotals` (`@megasaver/core` re-export), `minBytesFor` (`apps/cli/src/hooks/saver.ts`), `resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps` (`@megasaver/context-gate`), `resolveStorePath`/`readStoreEnv` (`apps/cli/src/store.ts`), cli-test-pattern (`wiki/workflows/cli-test-pattern.md`).

## Global Constraints

- **Honest-metrics hard rule.** A byte figure is measured (fs `stat` at scan time, or a recorded event total) or it is ABSENT — an unmeasured call is a count, never a byte estimate. Token figures come only from `tokensFromBytes(measuredBytes)` and every render labels them `(est.)`. NO dollar output anywhere: the report type has no price field, and a test asserts it structurally.
- **Read-only.** No new capture, no new hook fields, no writes from the scanner or the command. The §13.4 hook contracts (always exit 0, metadata-only) are untouched — `mega discover` is a normal command (exit 0/1), not a hook.
- **Dependency graph.** `@megasaver/stats` gains no new deps. apps/cli consumes the new scanner symbols via `@megasaver/core` only (`apps/cli/test/dependency-graph.test.ts` must stay green); direct `@megasaver/context-gate` imports for activation follow the `hooks/status.ts` precedent.
- **Single floor/coverage authority.** Floors come from `minBytesFor` (already exported) and coverage from a new one-line `isSaverCoveredTool` wrapper in `hooks/saver.ts` — never a duplicated table.
- **No timing-tight tests.** All new logic is pure or mkdtemp-isolated; no wall-clock assertions, no sleeps (CI-slowness lesson, repo test discipline).
- TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM `.js` specifiers, `process.env` bracket access with the standard `biome-ignore` where needed.

## File Structure

| File | Responsibility |
|---|---|
| `packages/stats/src/discover.ts` (create) | `HookLogRow`, `parseHookLogRows`, `scanExposure`, `ExposureReport`, `DISCOVER_HOOK_MISSING_HINT` |
| `packages/stats/src/index.ts` (modify) | Export the new surface |
| `packages/core/src/context-gate.ts` (modify) | Re-export the new stats symbols (existing stats block pattern) |
| `apps/cli/src/hooks/saver.ts` (modify) | Export `isSaverCoveredTool` (wraps private `resolveSourceKind`) |
| `apps/cli/src/commands/discover.ts` (create) | `runDiscover` + `discoverCommand` + `buildExposureNudgeLines` |
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
- Contract: lenient per-line parse of the log written by `apps/cli/src/hooks/logger.ts` (`{timestamp, agent, tool, category, filePath?, sessionId?}`); blank/malformed/partial-tail lines are skipped, mirroring `ingestHookLog` (`packages/stats/src/metrics.ts:85`).

- [ ] **Step 1: Write the failing test**

Create `packages/stats/test/discover.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHookLogRows } from "../src/discover.js";

const LINE = JSON.stringify({
  timestamp: "2026-08-06T10:00:00.000Z",
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
    expect(rows[0]?.filePath).toBe("/repo/src/big.ts");
  });

  it("tolerates rows without filePath/sessionId (Bash, Grep)", () => {
    const bash = JSON.stringify({
      timestamp: "2026-08-06T10:00:01.000Z",
      agent: "claude-code",
      tool: "Bash",
      category: "eligible_command",
    });
    const rows = parseHookLogRows(`${bash}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.filePath).toBeUndefined();
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
export const hookLogRowSchema = z.object({
  timestamp: z.string(),
  tool: z.string(),
  category: z.string(),
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

### Task 2: Exposure scanner (pure classifier)

**Files:**
- Modify: `packages/stats/src/discover.ts`
- Modify: `packages/stats/test/discover.test.ts`

**Interfaces:**
- Produces: `type ExposureCause`, `type ExposureGroup`, `type ExposureScanInput`, `type ExposureReport`, `scanExposure(input): ExposureReport`, `DISCOVER_HOOK_MISSING_HINT`.
- Classification (spec Locked Decision 2), enabled workspace, per row: `!coveredTool(tool)` → `source_uncovered`; `category === "eligible_mcp"` → `mcp_unproxied` (count-only); `filePath` present and `sizeOf(filePath) <= floorFor(tool)` → `below_floor` (measured, "current size on disk"); `filePath` sized above floor → covered, excluded; anything else → `noSizeEvidenceCalls` (never bytes). Disabled/null activation: every row → `workspace_disabled`. `hookLogPresent === false` → empty groups + hint.

- [ ] **Step 1: Write the failing test**

Append to `packages/stats/test/discover.test.ts`:

```typescript
import {
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureScanInput,
  type HookLogRow,
  scanExposure,
} from "../src/discover.js";
import { tokensFromBytes } from "../src/honest-metrics.js";

const row = (over: Partial<HookLogRow> = {}): HookLogRow => ({
  timestamp: "2026-08-06T10:00:00.000Z",
  tool: "Read",
  category: "eligible_read",
  ...over,
});

const baseInput = (over: Partial<ExposureScanInput> = {}): ExposureScanInput => ({
  hookLogPresent: true,
  rows: [],
  activation: { enabled: true, mode: "safe" },
  floorFor: () => 32_000,
  coveredTool: () => true,
  sizeOf: () => undefined,
  mediatedEvents: 0,
  ...over,
});

describe("scanExposure", () => {
  it("missing hook log -> no groups, no numbers, install hint", () => {
    const report = scanExposure(baseInput({ hookLogPresent: false }));
    expect(report.groups).toHaveLength(0);
    expect(report.totalMeasuredBytes).toBe(0);
    expect(report.hint).toBe(DISCOVER_HOOK_MISSING_HINT);
  });

  it("disabled workspace: every row is exposure, measured/unmeasured split", () => {
    const rows = [
      row({ filePath: "/repo/a.ts" }),
      row({ tool: "Bash", category: "eligible_command" }),
    ];
    const report = scanExposure(
      baseInput({ rows, activation: null, sizeOf: (p) => (p === "/repo/a.ts" ? 5_000 : undefined) }),
    );
    const g = report.groups[0];
    expect(g?.cause).toBe("workspace_disabled");
    expect(g?.calls).toBe(2);
    expect(g?.measuredBytes).toBe(5_000);
    expect(g?.unmeasuredCalls).toBe(1);
    expect(g?.remediation).toBe("mega session saver workspace enable");
    expect(g?.estTokens).toBe(tokensFromBytes(5_000));
  });

  it("below-floor is boundary-exact: size == floor is exposure, floor+1 is not", () => {
    const rows = [row({ filePath: "/repo/eq.ts" }), row({ filePath: "/repo/over.ts" })];
    const sizes: Record<string, number> = { "/repo/eq.ts": 32_000, "/repo/over.ts": 32_001 };
    const report = scanExposure(baseInput({ rows, sizeOf: (p) => sizes[p] }));
    const g = report.groups.find((x) => x.cause === "below_floor");
    expect(g?.calls).toBe(1);
    expect(g?.measuredBytes).toBe(32_000);
  });

  it("uncovered tools and eligible_mcp group separately; mcp stays count-only", () => {
    const rows = [
      row({ tool: "FutureTool", category: "eligible_read" }),
      row({ tool: "mcp__github__search", category: "eligible_mcp" }),
    ];
    const report = scanExposure(
      baseInput({ rows, coveredTool: (t) => t !== "FutureTool" }),
    );
    expect(report.groups.map((g) => g.cause).sort()).toEqual([
      "mcp_unproxied",
      "source_uncovered",
    ]);
    const mcp = report.groups.find((g) => g.cause === "mcp_unproxied");
    expect(mcp?.measuredBytes).toBe(0);
    expect(mcp?.remediation).toBe("mega mcp install");
  });

  it("covered above-floor file reads are not exposure and not 'no evidence'", () => {
    const report = scanExposure(
      baseInput({ rows: [row({ filePath: "/repo/big.ts" })], sizeOf: () => 100_000 }),
    );
    expect(report.groups).toHaveLength(0);
    expect(report.noSizeEvidenceCalls).toBe(0);
  });

  it("report window spans row timestamps; groups sort by measuredBytes desc", () => {
    const rows = [
      row({ timestamp: "2026-08-01T00:00:00.000Z", tool: "FutureTool" }),
      row({ timestamp: "2026-08-06T00:00:00.000Z", filePath: "/repo/a.ts" }),
    ];
    const report = scanExposure(
      baseInput({ rows, coveredTool: (t) => t !== "FutureTool", sizeOf: () => 1_000 }),
    );
    expect(report.window).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-06T00:00:00.000Z",
    });
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
  | "below_floor";

export type ExposureGroup = {
  cause: ExposureCause;
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  estTokens: number;
  unmeasuredCalls: number;
  uniqueFiles: number;
  remediation: string;
};

export type ExposureScanInput = {
  hookLogPresent: boolean;
  rows: readonly HookLogRow[];
  activation: { enabled: boolean; mode: TokenSaverMode } | null;
  floorFor: (tool: string) => number;
  coveredTool: (tool: string) => boolean;
  sizeOf: (filePath: string) => number | undefined;
  mediatedEvents: number;
};

export type ExposureReport = {
  hookLogPresent: boolean;
  saverEnabled: boolean;
  mode: TokenSaverMode | null;
  window: { from: string; to: string } | null;
  groups: ExposureGroup[];
  noSizeEvidenceCalls: number;
  mediatedEvents: number;
  totalMeasuredBytes: number;
  hint: string | null;
};

// Mirrors HOOK_MISSING_HINT discipline (metrics.ts): absent evidence yields
// an install suggestion, never a fabricated number.
export const DISCOVER_HOOK_MISSING_HINT =
  "No hook telemetry found. Exposure cannot be measured. Run: mega hooks install claude-code";

const NEXT_SMALLER_MODE: Record<TokenSaverMode, TokenSaverMode | null> = {
  safe: "balanced",
  balanced: "aggressive",
  aggressive: null,
};

function remediationFor(cause: ExposureCause, mode: TokenSaverMode | null): string {
  switch (cause) {
    case "workspace_disabled":
      return "mega session saver workspace enable";
    case "source_uncovered":
      return "none — Mega Saver coverage gap (report the tool name upstream)";
    case "mcp_unproxied":
      return "mega mcp install";
    case "below_floor": {
      const next = mode === null ? null : NEXT_SMALLER_MODE[mode];
      return next === null
        ? "already at the smallest floor (aggressive)"
        : `mega session saver workspace enable --mode ${next}`;
    }
  }
}

type MutableGroup = {
  calls: number;
  measuredCalls: number;
  measuredBytes: number;
  unmeasuredCalls: number;
  files: Set<string>;
};

export function scanExposure(input: ExposureScanInput): ExposureReport {
  const enabled = input.activation !== null && input.activation.enabled;
  const mode = enabled && input.activation !== null ? input.activation.mode : null;
  const empty = (): MutableGroup => ({
    calls: 0,
    measuredCalls: 0,
    measuredBytes: 0,
    unmeasuredCalls: 0,
    files: new Set<string>(),
  });
  const groups = new Map<ExposureCause, MutableGroup>();
  let noSizeEvidenceCalls = 0;
  let from: string | null = null;
  let to: string | null = null;

  const add = (cause: ExposureCause, row: HookLogRow, size: number | undefined): void => {
    const g = groups.get(cause) ?? empty();
    g.calls += 1;
    if (size === undefined) {
      g.unmeasuredCalls += 1;
    } else {
      g.measuredCalls += 1;
      g.measuredBytes += size;
      if (row.filePath !== undefined) g.files.add(row.filePath);
    }
    groups.set(cause, g);
  };

  if (input.hookLogPresent) {
    for (const row of input.rows) {
      // ISO-8601 same-format timestamps compare lexicographically.
      if (from === null || row.timestamp < from) from = row.timestamp;
      if (to === null || row.timestamp > to) to = row.timestamp;
      const size = row.filePath === undefined ? undefined : input.sizeOf(row.filePath);
      if (!enabled) {
        add("workspace_disabled", row, size);
        continue;
      }
      if (!input.coveredTool(row.tool)) {
        add("source_uncovered", row, size);
        continue;
      }
      if (row.category === "eligible_mcp") {
        // Count-only by design: MCP results carry no stat-able path and the
        // hook covers them at floor max(mode budget, 16 384 B) — 32 000 B
        // under safe — the gap is proxy metering.
        add("mcp_unproxied", row, undefined);
        continue;
      }
      if (size !== undefined) {
        if (size <= input.floorFor(row.tool)) add("below_floor", row, size);
        // else: covered path — not exposure, not "no evidence".
        continue;
      }
      noSizeEvidenceCalls += 1;
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
      remediation: remediationFor(cause, mode),
    }))
    .sort(
      (a, b) =>
        b.measuredBytes - a.measuredBytes ||
        b.calls - a.calls ||
        a.cause.localeCompare(b.cause),
    );

  return {
    hookLogPresent: input.hookLogPresent,
    saverEnabled: enabled,
    mode,
    window: from !== null && to !== null ? { from, to } : null,
    groups: finalized,
    noSizeEvidenceCalls,
    mediatedEvents: input.mediatedEvents,
    totalMeasuredBytes: finalized.reduce((sum, g) => sum + g.measuredBytes, 0),
    hint: input.hookLogPresent ? null : DISCOVER_HOOK_MISSING_HINT,
  };
}
```

- [ ] **Step 4: GREEN** — vitest run passes; `pnpm --filter @megasaver/stats typecheck` clean; `pnpm exec biome check packages/stats` clean.
- [ ] **Step 5: Commit** — `feat(stats): exposure scanner groups bypass causes`

---

### Task 3: Public surface — stats index + core re-export

**Files:**
- Modify: `packages/stats/src/index.ts`
- Modify: `packages/core/src/context-gate.ts`
- Modify: `packages/stats/test/discover.test.ts`

**Interfaces:**
- Produces: `parseHookLogRows`, `scanExposure`, `hookLogRowSchema`, `DISCOVER_HOOK_MISSING_HINT`, and the four types exported from `@megasaver/stats`; re-exported from `@megasaver/core` in the existing stats block of `packages/core/src/context-gate.ts` (pattern at lines 33-55, where `ingestHookLog`/`buildProxyMetrics` already live).

- [ ] **Step 1: Write the failing test** — append to `packages/stats/test/discover.test.ts`:

```typescript
import * as statsIndex from "../src/index.js";

describe("discover public surface", () => {
  it("exports the scanner through the package index", () => {
    expect(typeof statsIndex.parseHookLogRows).toBe("function");
    expect(typeof statsIndex.scanExposure).toBe("function");
  });
});
```

- [ ] **Step 2: RED** — vitest run fails on the index import.
- [ ] **Step 3: Implement** — add to `packages/stats/src/index.ts`:

```typescript
export {
  DISCOVER_HOOK_MISSING_HINT,
  hookLogRowSchema,
  parseHookLogRows,
  scanExposure,
  type ExposureCause,
  type ExposureGroup,
  type ExposureReport,
  type ExposureScanInput,
  type HookLogRow,
} from "./discover.js";
```

Add the identical `export { ... } from "@megasaver/stats";` block to `packages/core/src/context-gate.ts` (append after the existing stats blocks).

- [ ] **Step 4: GREEN** — stats vitest passes; `pnpm --filter @megasaver/core typecheck` proves the re-export resolves; `pnpm --filter @megasaver/stats exec vitest run test/dependency-graph.test.ts` stays green.
- [ ] **Step 5: Commit** — `feat(core): re-export discover scan surface`

---

### Task 4: `mega discover` command

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (one exported wrapper)
- Create: `apps/cli/src/commands/discover.ts`
- Modify: `apps/cli/src/main.ts`
- Create: `apps/cli/test/discover.test.ts`

**Interfaces:**
- Produces: `isSaverCoveredTool(tool: string): boolean` (saver.ts); `RunDiscoverInput`, `runDiscover(input): Promise<0 | 1>`, `CollectExposureInput`, `collectExposureReport(input): ExposureReport` (the store-resolved scan pipeline, shared with the Task 5 nudge), `discoverCommand`, `buildExposureNudgeLines(report, max)` (discover.ts).
- `RunDiscoverInput` follows `RunHooksStatusInput` (`hooks/status.ts`): store slice + `hookLogPath?` override + injectable `resolveActivation?: (storeRoot: string, cwd: string) => { enabled: boolean; mode: TokenSaverMode } | null` (SaverDeps injection precedent) + `stdout`/`stderr`/`json`.
- Production wiring: activation via `resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps())` mapped as in `saver-run.ts:33`; floors via `minBytesFor(tool, mode ?? "safe")`; coverage via `isSaverCoveredTool`; sizes via `statSync` (isFile guard, try/catch → `undefined`); mediated context via `readWorkspaceTokenSaverTotals({ root }, encodeWorkspaceKey(cwd))` → `eventsTotal` (try/catch → 0); log path `join(cwd, HOOK_LOG_RELATIVE_PATH)`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/discover.test.ts` (cli-test-pattern: direct inner-function invocation, mkdtemp isolation, no env vars needed since deps are injected):

```typescript
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiscover } from "../src/commands/discover.js";

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
    expect(out.join("\n")).not.toMatch(/\d+ B measured/);
  });

  it("disabled workspace groups all calls with the enable remediation", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(2_000));
    await writeHookLog([
      { timestamp: "2026-08-06T10:00:00.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
      { timestamp: "2026-08-06T10:00:01.000Z", agent: "claude-code", tool: "Bash", category: "eligible_command" },
    ]);
    const code = await runDiscover({ ...baseInput(), resolveActivation: () => null });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("workspace disabled");
    expect(text).toContain("2000 B measured");
    expect(text).toContain("fix: mega session saver workspace enable");
    expect(text).toContain("(est.");
  });

  it("--json emits one parseable line with measured fields only", async () => {
    const target = join(cwd, "small.ts");
    await writeFile(target, "x".repeat(1_000));
    await writeHookLog([
      { timestamp: "2026-08-06T10:00:00.000Z", agent: "claude-code", tool: "Read", category: "eligible_read", filePath: target },
    ]);
    const code = await runDiscover({
      ...baseInput(),
      json: true,
      resolveActivation: () => ({ enabled: true, mode: "safe" as const }),
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0] ?? "");
    expect(report.groups[0]?.cause).toBe("below_floor");
    expect(report.groups[0]?.measuredBytes).toBe(1_000);
    expect(JSON.stringify(report)).not.toMatch(/usd|dollar|price|\$/i);
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
- [ ] **Step 3: Implement** — `isSaverCoveredTool` in `apps/cli/src/hooks/saver.ts`:

```typescript
export function isSaverCoveredTool(tool: string): boolean {
  return resolveSourceKind(tool) !== undefined;
}
```

Create `apps/cli/src/commands/discover.ts` (`buildExposureNudgeLines` is added in Task 5):

```typescript
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nodeResolverDeps, resolveWorkspaceTokenSaverSettings } from "@megasaver/context-gate";
import {
  DISCOVER_HOOK_MISSING_HINT,
  type ExposureReport,
  parseHookLogRows,
  readWorkspaceTokenSaverTotals,
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
  // Injectable for tests; production resolves <cwd>/.megasaver/hooks/... .
  hookLogPath?: string;
  // SaverDeps injection precedent (saver-run.ts resolveSettings).
  resolveActivation?: (
    storeRoot: string,
    cwd: string,
  ) => { enabled: boolean; mode: TokenSaverMode } | null;
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

// stat only, never open: a failed stat moves the call to unmeasured.
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

  let mediatedEvents = 0;
  try {
    const totals = readWorkspaceTokenSaverTotals(
      { root: input.storeRoot },
      encodeWorkspaceKey(input.cwd),
    );
    mediatedEvents = totals?.eventsTotal ?? 0;
  } catch {
    // No stats tree yet — mediated context is simply zero.
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

function renderReport(report: ExposureReport): string[] {
  if (!report.hookLogPresent) return [report.hint ?? DISCOVER_HOOK_MISSING_HINT];
  const lines = ["Unfiltered exposure (measured bytes only — no counterfactuals):"];
  lines.push(`  saver: ${report.saverEnabled ? `enabled (${report.mode})` : "disabled"}`);
  if (report.window !== null) {
    lines.push(`  window: ${report.window.from} -> ${report.window.to}`);
  }
  report.groups.forEach((g, i) => {
    const unmeasured =
      g.unmeasuredCalls > 0 ? `, ${plural(g.unmeasuredCalls, "call")} unmeasured` : "";
    lines.push(
      `  ${i + 1}. ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}, ${g.measuredBytes} B measured across ${plural(g.uniqueFiles, "file")} (est. ~${g.estTokens} tokens, bytes/4)${unmeasured}`,
    );
    lines.push(`     fix: ${g.remediation}`);
  });
  if (report.groups.length === 0) lines.push("  (no exposure found)");
  lines.push(`  mediated by saver: ${report.mediatedEvents} events`);
  lines.push(`  no size evidence: ${plural(report.noSizeEvidenceCalls, "call")} (not estimated)`);
  return lines;
}

export async function runDiscover(input: RunDiscoverInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    // The only failure path, mirroring runHooksStatus (hooks/status.ts:195).
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
    input.stdout(JSON.stringify(report));
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

Example text render (bytes in `B` like `hooks/status.ts`; tokens always `(est. ~N tokens, bytes/4)`):

```
Unfiltered exposure (measured bytes only — no counterfactuals):
  saver: disabled            [or: enabled (safe)]
  window: <from> -> <to>
  1. workspace disabled — 2 calls, 2000 B measured across 1 file (est. ~500 tokens, bytes/4), 1 call unmeasured
     fix: mega session saver workspace enable
  mediated by saver: 0 events
  no size evidence: 0 calls (not estimated)
```

`apps/cli/src/main.ts` — exact diff (import list is alphabetical; `daemon` < `discover` < `doctor`):

```diff
 import { daemonCommand } from "./commands/daemon/index.js";
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
- Produces: `buildExposureNudgeLines(report: ExposureReport, max = 3): string[]` — pure; one line per non-empty group: `exposure: <cause label> — <calls> calls, <measuredBytes> B measured (fix: <remediation>)`; empty array when no groups.
- Install command gains `discover: { type: "boolean", default: false, description: "Append a top-3 unfiltered-exposure summary (reads local hook telemetry only)." }` and `RunHooksInstallInput` gains `discover: boolean` plus injectable `discoverLines?: () => string[]`. After a successful install (return-0 path), when `discover` is true: wrap `discoverLines()` in try/catch and print each line — best-effort exactly like the existing maintenance block ("must never affect the install result"); JSON mode unchanged (nudge is text-mode only, v1).

- [ ] **Step 1: Write the failing test** — append to `apps/cli/test/hooks/install.test.ts` (same mkdtemp settings-path rig as the `--no-warmup`/`--no-guard` describes at install.test.ts:250,291; direct `runHooksInstall` invocation is that file's established pattern):

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

- [ ] **Step 2: RED** — `pnpm --filter @megasaver/cli exec vitest run test/hooks/install.test.ts`.
- [ ] **Step 3: Implement** — append to `apps/cli/src/commands/discover.ts`:

```typescript
export function buildExposureNudgeLines(report: ExposureReport, max = 3): string[] {
  return report.groups
    .slice(0, max)
    .map(
      (g) =>
        `exposure: ${g.cause.replace(/_/g, " ")} — ${plural(g.calls, "call")}, ${g.measuredBytes} B measured (fix: ${g.remediation})`,
    );
}
```

In `apps/cli/src/commands/hooks/install.ts`, extend `RunHooksInstallInput`
(optional fields, matching the existing `warmup?`/`guard?` style):

```typescript
  discover?: boolean;
  // Injectable for tests; production wires collectExposureReport (Task 4).
  discoverLines?: () => string[];
```

and insert before `runHooksInstall`'s final `return 0;` (after the
maintenance trigger block):

```typescript
  // Opt-in exposure nudge (spec Locked Decision 6): best-effort exactly like
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

Citty wiring in `hooksInstallCommand`: add the arg

```typescript
    discover: {
      type: "boolean",
      default: false,
      description:
        "Append a top-3 unfiltered-exposure summary (reads local hook telemetry only).",
    },
```

and pass, in the `run` closure (imports: `buildExposureNudgeLines`,
`collectExposureReport` from `../discover.js`):

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

(`resolveStorePath` may throw inside the closure — that is fine: the
best-effort try/catch in `runHooksInstall` owns it.)
- [ ] **Step 4: GREEN** — install tests pass; `pnpm --filter @megasaver/cli typecheck`; biome clean.
- [ ] **Step 5: Commit** — `feat(cli): opt-in exposure nudge on install`

---

### Task 6: Changeset, wiki, full verification

**Files:**
- Create: `.changeset/mega-discover.md`
- Modify: `wiki/entities/cli.md`, `wiki/entities/stats.md`, `wiki/log.md`

- [ ] **Step 1: Changeset** — minor bumps for `@megasaver/stats`, `@megasaver/core`, `@megasaver/cli`: "mega discover: honest missed-savings finder — measured unfiltered-exposure report grouped by bypass cause, --json, opt-in install nudge. Measured bytes only; token figures labeled estimates; no dollar claims."
- [ ] **Step 2: Wiki** — `entities/cli.md`: add `mega discover` + the `hooks install --discover` flag; `entities/stats.md`: add the discover scanner to the public surface with the honest-metrics note; timestamped `log.md` entry.
- [ ] **Step 3: Full gate** — `pnpm verify` (lint + typecheck + all tests) green at branch tip; re-run the Task 4 smoke.
- [ ] **Step 4: Commit** — `docs: changeset and wiki for mega discover`
- [ ] **Step 5: Review request (DoD #6)** — dispatch `code-reviewer` in a fresh context (author ≠ reviewer; MEDIUM risk per spec).

## Verified-Symbol Ledger

`ingestHookLog`/`buildProxyMetrics`/`computeInterception`/`HOOK_MISSING_HINT` (`packages/stats/src/metrics.ts:85,146,116,132` — already re-exported by core at `packages/core/src/context-gate.ts:39-43`); `tokensFromBytes` (`packages/stats/src/honest-metrics.ts:96`); `HOOK_LOG_RELATIVE_PATH` + line shape (`apps/cli/src/hooks/logger.ts:42,44-51`); `minBytesFor`, `NEW_SURFACE_MIN_BYTES = 16_384`, `BASH_COMPRESS_FLOOR = 24_000`, private `resolveSourceKind` (`apps/cli/src/hooks/saver.ts:64,29,37,39`); `modeToBudget` safe 32 000 / balanced 12 000 / aggressive 4 000 (`packages/shared/src/token-saver-mode.ts:15`); `resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps` (`packages/context-gate/src/resolve-saver-settings.ts:68,232`; CLI usage precedent `apps/cli/src/hooks/saver-run.ts:33`); `readWorkspaceTokenSaverTotals` (core re-export, usage `apps/cli/src/commands/hooks/status.ts:155`); `encodeWorkspaceKey` (`@megasaver/shared`); enable command `mega session saver workspace enable [--mode]` (`apps/cli/src/commands/session/saver/workspace.ts:130`); non-compressed `record()` persists nothing (`packages/context-gate/src/record-output.ts:260`).

Verified: `apps/cli/test/hooks/saver.test.ts` and `apps/cli/test/hooks/install.test.ts` exist, and install.test.ts already invokes `runHooksInstall` programmatically with injected inputs (the `--no-warmup`/`--no-guard` describes, install.test.ts:264,277,305) alongside a separate Citty-parse describe (install.test.ts:489) — the Task 5 tests append to that established direct-invocation pattern (both invocation styles are sanctioned by `wiki/workflows/cli-test-pattern.md`).

Verified: `mega mcp install` is the remediation command for `mcp_unproxied` — `mcpInstallCommand` carries meta name `"install"` (`apps/cli/src/commands/mcp/install.ts:67`) and is registered as the `install` subcommand of `mcpCommand` (`apps/cli/src/commands/mcp/index.ts:17`).
