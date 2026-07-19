# Net-Positive MegaSaver — Stage A (P0 guardrail + P1 cache-safe saver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage A of `docs/superpowers/specs/2026-07-19-net-positive-megasaver-design.md` — the saver never costs more than baseline: a workspace net-effect estimator that auto-pauses a net-negative saver, plus first-sight-only compression that structurally kills prompt-cache churn.

**Architecture:** Pure estimator math lives in `@megasaver/stats` (no I/O). Persistence (verdict file, seen-hash ledger) lives in `@megasaver/context-gate` beside the existing saver store. The CLI hook (`apps/cli/src/hooks/saver.ts`) gains two decision gates wired through injected `SaverDeps` (tests need no fs). Doctor computes + persists the verdict; the hook only reads it.

**Tech Stack:** TypeScript strict ESM, Vitest, Zod at boundaries, existing atomic-write patterns (tmp + rename).

**Worktree:** create via `superpowers:using-git-worktrees`: branch `feat/net-positive-stage-a` off `main`.

**Verification baseline:** `cd <worktree> && pnpm install --frozen-lockfile && pnpm build && pnpm verify` must be green BEFORE Task 1 (v2.1.1 lint was fixed in 3060e892; if verify is red at base, stop and report).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/stats/src/net-effect.ts` | create | pure estimator: saved tokens vs cache-churn excess → verdict |
| `packages/stats/src/index.ts` | modify | export estimator |
| `packages/stats/test/net-effect.test.ts` | create | estimator unit tests |
| `packages/context-gate/src/net-effect-store.ts` | create | verdict file read/write + pause predicate + resume override |
| `packages/context-gate/src/saver-seen.ts` | create | per-session content-hash ledger |
| `packages/context-gate/src/index.ts` | modify | export both |
| `packages/context-gate/test/net-effect-store.test.ts` | create | store tests |
| `packages/context-gate/test/saver-seen.test.ts` | create | ledger tests |
| `apps/cli/src/hooks/saver.ts` | modify | pause gate + seen gate + stable chunk id |
| `apps/cli/src/hooks/saver-run.ts` | modify | wire new deps |
| `apps/cli/test/hooks/saver.test.ts` | modify | decision-table tests |
| `apps/cli/src/commands/session/saver/resume.ts` | create | `mega session saver resume` |
| `apps/cli/src/commands/session/saver/index.ts` | modify | register subcommand |
| `apps/cli/test/commands/session-saver-resume.test.ts` | create | command test |
| `apps/cli/src/commands/doctor-saver.ts` | modify | `saver-net-effect` check (compute + persist + report) |
| `.changeset/net-positive-stage-a.md` | create | release note |

---

### Task 1: Pure net-effect estimator (`@megasaver/stats`)

**Files:**
- Create: `packages/stats/src/net-effect.ts`
- Modify: `packages/stats/src/index.ts` (append export)
- Test: `packages/stats/test/net-effect.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/stats/test/net-effect.test.ts
import { describe, expect, it } from "vitest";
import { estimateNetEffect } from "../src/net-effect.js";

const NOW = "2026-07-19T12:00:00.000Z";
const IN_WINDOW = "2026-07-18T12:00:00.000Z";
const OLD = "2026-07-01T12:00:00.000Z";

// Continuation rows (messageCount >= 3). appendMedian of [1000,1000,1000] = 1000.
const flatRows = (n: number, cc: number) =>
  Array.from({ length: n }, (_, i) => ({
    ts: IN_WINDOW,
    cacheCreationTokens: cc,
    messageCount: 3 + i,
  }));

describe("estimateNetEffect", () => {
  it("verdict ok when saved tokens exceed churn excess", () => {
    // 20 rows at the median → churn excess 0; 4000 bytes saved ≈ 1000 tokens.
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: flatRows(20, 1000),
    });
    expect(v).toMatchObject({ workspaceKey: "wk1", verdict: "ok", churnTokens: 0 });
    expect(v?.savedTokens).toBe(1000);
  });

  it("verdict negative when churn excess dwarfs savings", () => {
    // 19 rows at 1000 + 1 spike of 101000 → excess = 100000, all attributed to
    // the only compressing workspace. saved 1000 tokens << 100000.
    const rows = [...flatRows(19, 1000), { ts: IN_WINDOW, cacheCreationTokens: 101_000, messageCount: 5 }];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: rows,
    });
    expect(v?.verdict).toBe("negative");
    expect(v?.churnTokens).toBe(100_000);
  });

  it("churn excess splits by compression share across workspaces", () => {
    const rows = [...flatRows(19, 1000), { ts: IN_WINDOW, cacheCreationTokens: 41_000, messageCount: 5 }];
    const out = estimateNetEffect({
      nowIso: NOW,
      workspaces: [
        { workspaceKey: "a", savedBytesInWindow: 400_000, compressionsInWindow: 3 }, // 100k saved
        { workspaceKey: "b", savedBytesInWindow: 4000, compressionsInWindow: 1 },    // 1k saved
      ],
      usageRows: rows,
    });
    // excess 40k → a gets 30k (share 3/4) → ok; b gets 10k (share 1/4) → negative.
    expect(out.find((v) => v.workspaceKey === "a")?.verdict).toBe("ok");
    expect(out.find((v) => v.workspaceKey === "b")?.verdict).toBe("negative");
  });

  it("unknown when usage rows are insufficient (< 20 continuation rows in window)", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: flatRows(5, 1000),
    });
    expect(v?.verdict).toBe("unknown");
  });

  it("unknown when the workspace produced no compressions in window", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 0, compressionsInWindow: 0 }],
      usageRows: flatRows(25, 1000),
    });
    expect(v?.verdict).toBe("unknown");
  });

  it("ignores rows outside the 7-day window and first/second requests (messageCount < 3)", () => {
    const rows = [
      ...flatRows(20, 1000),
      { ts: OLD, cacheCreationTokens: 900_000, messageCount: 5 },   // outside window
      { ts: IN_WINDOW, cacheCreationTokens: 900_000, messageCount: 2 }, // session-start write, not churn
    ];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 2 }],
      usageRows: rows,
    });
    expect(v?.verdict).toBe("ok");
    expect(v?.churnTokens).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @megasaver/stats exec vitest run test/net-effect.test.ts`
Expected: FAIL — `Cannot find module '../src/net-effect.js'`

- [ ] **Step 3: Implement**

```ts
// packages/stats/src/net-effect.ts
import { tokensFromBytes } from "./honest-metrics.js";

// Stage A / P0 (spec 2026-07-19-net-positive-megasaver-design.md): estimate
// whether the saver is net-positive per workspace. Pure — callers do all I/O.
//
// churn model: proxied requests with messageCount >= 3 are continuation turns;
// their cache_creation should sit near the append median. Anything above the
// median is "excess" — the churn signature the saver can cause. Excess is
// attributed to workspaces by their share of compressions in the window,
// because the ledger rows themselves carry no workspace key.

export type ProxyUsageRow = {
  ts: string;
  cacheCreationTokens: number;
  messageCount: number;
};

export type WorkspaceWindowStats = {
  workspaceKey: string;
  savedBytesInWindow: number;
  compressionsInWindow: number;
};

export type NetEffectVerdict = {
  workspaceKey: string;
  savedTokens: number;
  churnTokens: number;
  verdict: "ok" | "negative" | "unknown";
};

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Below this many continuation rows the median is noise — never pause on noise.
const MIN_CONTINUATION_ROWS = 20;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  // biome-ignore lint/style/noNonNullAssertion: length checked by callers
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function estimateNetEffect(input: {
  nowIso: string;
  workspaces: readonly WorkspaceWindowStats[];
  usageRows: readonly ProxyUsageRow[];
}): NetEffectVerdict[] {
  const since = Date.parse(input.nowIso) - WINDOW_MS;
  const continuation = input.usageRows.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= since && r.messageCount >= 3;
  });

  const totalCompressions = input.workspaces.reduce((n, w) => n + w.compressionsInWindow, 0);

  let excess = 0;
  if (continuation.length >= MIN_CONTINUATION_ROWS) {
    const med = median(continuation.map((r) => r.cacheCreationTokens).sort((a, b) => a - b));
    for (const r of continuation) excess += Math.max(0, r.cacheCreationTokens - med);
  }

  return input.workspaces.map((w) => {
    const savedTokens = tokensFromBytes(Math.max(0, w.savedBytesInWindow));
    if (
      continuation.length < MIN_CONTINUATION_ROWS ||
      w.compressionsInWindow === 0 ||
      totalCompressions === 0
    ) {
      return { workspaceKey: w.workspaceKey, savedTokens, churnTokens: 0, verdict: "unknown" };
    }
    const churnTokens = Math.round(excess * (w.compressionsInWindow / totalCompressions));
    return {
      workspaceKey: w.workspaceKey,
      savedTokens,
      churnTokens,
      verdict: savedTokens - churnTokens < 0 ? "negative" : "ok",
    };
  });
}
```

Append to `packages/stats/src/index.ts`:

```ts
export {
  estimateNetEffect,
  type NetEffectVerdict,
  type ProxyUsageRow,
  type WorkspaceWindowStats,
} from "./net-effect.js";
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter @megasaver/stats exec vitest run test/net-effect.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add packages/stats/src/net-effect.ts packages/stats/src/index.ts packages/stats/test/net-effect.test.ts
git commit -m "feat(stats): pure net-effect estimator for saver guardrail"
```

---

### Task 2: Verdict store + pause predicate (`@megasaver/context-gate`)

**Files:**
- Create: `packages/context-gate/src/net-effect-store.ts`
- Modify: `packages/context-gate/src/index.ts` (append export)
- Test: `packages/context-gate/test/net-effect-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/context-gate/test/net-effect-store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readNetEffectRecord,
  saverPausedByNetEffect,
  writeNetEffectRecord,
  writeResumeOverride,
} from "../src/net-effect-store.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-neteffect-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

const WK = "wk1";
const NOW = "2026-07-19T12:00:00.000Z";

describe("net-effect store", () => {
  it("round-trips a verdict record", () => {
    writeNetEffectRecord(store, WK, {
      savedTokens: 100, churnTokens: 900, verdict: "negative", updatedAt: NOW,
    });
    expect(readNetEffectRecord(store, WK)?.verdict).toBe("negative");
  });

  it("pause predicate: negative verdict pauses, ok/unknown/missing do not", () => {
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false); // missing file
    writeNetEffectRecord(store, WK, { savedTokens: 1, churnTokens: 0, verdict: "ok", updatedAt: NOW });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    writeNetEffectRecord(store, WK, { savedTokens: 0, churnTokens: 0, verdict: "unknown", updatedAt: NOW });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    writeNetEffectRecord(store, WK, { savedTokens: 1, churnTokens: 99, verdict: "negative", updatedAt: NOW });
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(true);
  });

  it("resume override lifts the pause for 7 days, then it re-arms", () => {
    writeNetEffectRecord(store, WK, { savedTokens: 1, churnTokens: 99, verdict: "negative", updatedAt: NOW });
    writeResumeOverride(store, WK, NOW);
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
    const eightDaysLater = "2026-07-27T12:00:01.000Z";
    expect(saverPausedByNetEffect(store, WK, eightDaysLater)).toBe(true);
  });

  it("corrupt file reads as null and never pauses", () => {
    writeNetEffectRecord(store, WK, { savedTokens: 1, churnTokens: 99, verdict: "negative", updatedAt: NOW });
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(store, "stats", WK, "net-effect.json"), "{corrupt");
    expect(readNetEffectRecord(store, WK)).toBeNull();
    expect(saverPausedByNetEffect(store, WK, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/net-effect-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// packages/context-gate/src/net-effect-store.ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// P0 verdict persistence. Doctor computes and WRITES; the PostToolUse hook only
// READS (one small JSON per invocation — same cost class as settings reads).
// Fail-open everywhere: a missing or corrupt record never pauses the saver.

const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const netEffectRecordSchema = z.object({
  version: z.literal(1),
  savedTokens: z.number().int().nonnegative(),
  churnTokens: z.number().int().nonnegative(),
  verdict: z.enum(["ok", "negative", "unknown"]),
  updatedAt: z.string(),
  resumeOverrideAt: z.string().optional(),
});

export type NetEffectRecord = Omit<z.infer<typeof netEffectRecordSchema>, "version">;

function recordPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "net-effect.json");
}

function writeAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function writeNetEffectRecord(
  storeRoot: string,
  workspaceKey: string,
  record: Omit<NetEffectRecord, "resumeOverrideAt">,
): void {
  // Preserve an existing resume override across verdict refreshes.
  const prev = readNetEffectRecord(storeRoot, workspaceKey);
  writeAtomic(recordPath(storeRoot, workspaceKey), {
    version: 1,
    ...record,
    ...(prev?.resumeOverrideAt !== undefined ? { resumeOverrideAt: prev.resumeOverrideAt } : {}),
  });
}

export function writeResumeOverride(storeRoot: string, workspaceKey: string, atIso: string): void {
  const prev = readNetEffectRecord(storeRoot, workspaceKey);
  if (prev === null) return; // nothing to override
  writeAtomic(recordPath(storeRoot, workspaceKey), {
    version: 1,
    ...prev,
    resumeOverrideAt: atIso,
  });
}

export function readNetEffectRecord(storeRoot: string, workspaceKey: string): NetEffectRecord | null {
  const path = recordPath(storeRoot, workspaceKey);
  if (!existsSync(path)) return null;
  try {
    const parsed = netEffectRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return null;
    const { version: _v, ...rest } = parsed.data;
    return rest;
  } catch {
    return null;
  }
}

export function saverPausedByNetEffect(
  storeRoot: string,
  workspaceKey: string,
  nowIso: string,
): boolean {
  const record = readNetEffectRecord(storeRoot, workspaceKey);
  if (record === null || record.verdict !== "negative") return false;
  if (record.resumeOverrideAt !== undefined) {
    const at = Date.parse(record.resumeOverrideAt);
    if (Number.isFinite(at) && Date.parse(nowIso) - at < RESUME_WINDOW_MS) return false;
  }
  return true;
}
```

Append to `packages/context-gate/src/index.ts`:

```ts
export {
  readNetEffectRecord,
  saverPausedByNetEffect,
  writeNetEffectRecord,
  writeResumeOverride,
  type NetEffectRecord,
} from "./net-effect-store.js";
```

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/net-effect-store.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/net-effect-store.ts packages/context-gate/src/index.ts packages/context-gate/test/net-effect-store.test.ts
git commit -m "feat(context-gate): net-effect verdict store with fail-open pause predicate"
```

---

### Task 3: Pause gate in the saver decision

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (SaverDeps at ~line 61; `decide()` after the `resolveSettings` gate at ~line 296)
- Modify: `apps/cli/src/hooks/saver-run.ts` (deps wiring at ~line 163 call site's deps construction)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe blocks; reuse the file's `deps(...)` helper and a payload that otherwise compresses — copy the arrange section of the existing "compresses" happy-path test in the same file):

```ts
it("net-effect pause forces passthrough even when settings enable the saver", async () => {
  const d = deps({
    resolveSettings: () => ({ enabled: true, mode: "balanced" as const }),
    saverPaused: () => true,
  });
  const decision = await buildSaverDecision(compressiblePayload(), d);
  expect(decision).toEqual({ passthrough: true });
});

it("saverPaused defaults to not-paused when dep reports false", async () => {
  const d = deps({ saverPaused: () => false });
  const decision = await buildSaverDecision(compressiblePayload(), d);
  expect("updatedToolOutput" in decision).toBe(true);
});
```

(`compressiblePayload()` = whatever fixture the existing happy-path test uses; if it is inline, extract it into a local helper in the test file as part of this step.)

- [ ] **Step 2: Run, verify FAIL** — `saverPaused` is not a known dep:

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts`
Expected: type error / test failure

- [ ] **Step 3: Implement.** In `saver.ts` add to `SaverDeps`:

```ts
  // P0 guardrail: measured net-negative saver auto-pauses per workspace.
  // Read-only, fail-open (store layer returns false on any anomaly).
  saverPaused: (storeRoot: string, workspaceKey: string, nowIso: string) => boolean;
```

In `decide()`, immediately after the `if (settings === null || !settings.enabled) return PASSTHROUGH;` line:

```ts
  if (deps.saverPaused(deps.storeRoot, workspaceKey, new Date().toISOString()))
    return PASSTHROUGH;
```

In `saver-run.ts`, where the real deps object is built, add:

```ts
    saverPaused: saverPausedByNetEffect,
```

with `import { saverPausedByNetEffect } from "@megasaver/context-gate";` — and update every fake-deps constructor in `apps/cli/test/hooks/saver.test.ts`, `saver-run.test.ts`, `saver-roundtrip.test.ts`, `saver-worktree-inheritance.test.ts` with a default `saverPaused: () => false`.

- [ ] **Step 4: Run the four saver test files, verify green**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/saver.test.ts test/hooks/saver-run.test.ts test/hooks/saver-roundtrip.test.ts test/hooks/saver-worktree-inheritance.test.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/src/hooks/saver-run.ts apps/cli/test/hooks/
git commit -m "feat(cli): saver decision honors net-effect auto-pause"
```

---

### Task 4: `mega session saver resume`

**Files:**
- Create: `apps/cli/src/commands/session/saver/resume.ts`
- Modify: `apps/cli/src/commands/session/saver/index.ts` (add to `subCommands`)
- Test: `apps/cli/test/commands/session-saver-resume.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/commands/session-saver-resume.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNetEffectRecord, writeNetEffectRecord } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSaverResume } from "../../src/commands/session/saver/resume.js";

let store: string;
beforeEach(() => { store = mkdtempSync(join(tmpdir(), "mega-resume-")); });
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("mega session saver resume", () => {
  it("writes a resume override for the cwd workspace and reports it", () => {
    const lines: string[] = [];
    // encodeWorkspaceKey(cwd) must match what the command computes; the
    // command returns the key so the test asserts through its output.
    writeNetEffectRecordForCwd(store, process.cwd());
    const code = runSaverResume({ storeRoot: store, cwd: process.cwd(), stdout: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("resumed");
  });

  it("no verdict record → explains there is nothing to resume, exit 0", () => {
    const lines: string[] = [];
    const code = runSaverResume({ storeRoot: store, cwd: process.cwd(), stdout: (l) => lines.push(l) });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("no net-effect verdict");
  });
});

function writeNetEffectRecordForCwd(storeRoot: string, cwd: string): void {
  // Use the same encoder the production code uses.
  const { encodeWorkspaceKey } = require("@megasaver/context-gate") as {
    encodeWorkspaceKey: (cwd: string) => string;
  };
  writeNetEffectRecord(storeRoot, encodeWorkspaceKey(cwd), {
    savedTokens: 1, churnTokens: 99, verdict: "negative",
    updatedAt: "2026-07-19T12:00:00.000Z",
  });
}
```

(If `encodeWorkspaceKey` is not exported from `@megasaver/context-gate`, check where `apps/cli/src/hooks/saver.ts` imports it from and use that import in both the command and the test.)

- [ ] **Step 2: Run, verify FAIL** (module not found)

- [ ] **Step 3: Implement**

```ts
// apps/cli/src/commands/session/saver/resume.ts
import { encodeWorkspaceKey, readNetEffectRecord, writeResumeOverride } from "@megasaver/context-gate";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../../store.js";

export function runSaverResume(input: {
  storeRoot: string;
  cwd: string;
  stdout: (line: string) => void;
}): 0 | 1 {
  const wk = encodeWorkspaceKey(input.cwd);
  const record = readNetEffectRecord(input.storeRoot, wk);
  if (record === null) {
    input.stdout(`mega session saver resume: no net-effect verdict for this workspace (${wk}) — nothing to resume.`);
    return 0;
  }
  writeResumeOverride(input.storeRoot, wk, new Date().toISOString());
  input.stdout(
    `mega session saver resume: saver resumed for workspace ${wk} (verdict was ${record.verdict}; re-checks in 7 days).`,
  );
  return 0;
}

export const sessionSaverResumeCommand = defineCommand({
  meta: {
    name: "resume",
    description: "Lift a net-effect auto-pause for this workspace (re-checks after 7 days).",
  },
  args: { store: { type: "string", description: "Override store directory." } },
  run({ args }) {
    const storeRoot = resolveStorePath(readStoreEnv(typeof args.store === "string" ? args.store : undefined));
    process.exitCode = runSaverResume({ storeRoot, cwd: process.cwd(), stdout: console.log });
  },
});
```

Register in `apps/cli/src/commands/session/saver/index.ts` `subCommands`:

```ts
    resume: sessionSaverResumeCommand,
```

(match the import style of the sibling subcommands in that file).

- [ ] **Step 4: Run test file, verify green.** Also run `pnpm --filter @megasaver/cli typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/session/saver/resume.ts apps/cli/src/commands/session/saver/index.ts apps/cli/test/commands/session-saver-resume.test.ts
git commit -m "feat(cli): mega session saver resume lifts net-effect pause"
```

---

### Task 5: Doctor computes, persists, and reports the verdict

**Files:**
- Modify: `apps/cli/src/commands/doctor-saver.ts` (new check after the liveness block ~line 280)
- Test: extend the doctor-saver test file (find it: `grep -rl "saver-liveness" apps/cli/test/`; if none exists, create `apps/cli/test/commands/doctor-net-effect.test.ts` testing the helper directly)

- [ ] **Step 1: Write the failing test** — test the assembly helper as a unit:

```ts
// apps/cli/test/commands/doctor-net-effect.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNetEffectRecord } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refreshNetEffectVerdicts } from "../../src/commands/doctor-saver.js";

let store: string;
beforeEach(() => { store = mkdtempSync(join(tmpdir(), "mega-doctor-ne-")); });
afterEach(() => rmSync(store, { recursive: true, force: true }));

const NOW = "2026-07-19T12:00:00.000Z";

function seedOverlayEvents(wk: string, sessionId: string, events: object[]): void {
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.events.jsonl`),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

function seedUsage(rows: object[]): void {
  const dir = join(store, "proxy-usage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "usage.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

describe("refreshNetEffectVerdicts", () => {
  it("persists an ok verdict when savings exceed churn", () => {
    seedOverlayEvents("wk1", "s1", [
      { id: "e1", createdAt: NOW, sourceKind: "bash", label: "x", rawBytes: 400_000, returnedBytes: 0, bytesSaved: 400_000, savingRatio: 1, summary: "", mode: "balanced" },
    ]);
    seedUsage(Array.from({ length: 25 }, (_, i) => ({ ts: NOW, cacheCreationTokens: 1000, messageCount: 3 + i })));
    const checks = refreshNetEffectVerdicts(store, NOW);
    expect(checks.some((c) => c.key === "saver-net-effect" && c.pass)).toBe(true);
    expect(readNetEffectRecord(store, "wk1")?.verdict).toBe("ok");
  });

  it("no proxy ledger → unknown verdict, check passes with a warn", () => {
    seedOverlayEvents("wk1", "s1", [
      { id: "e1", createdAt: NOW, sourceKind: "bash", label: "x", rawBytes: 4000, returnedBytes: 0, bytesSaved: 4000, savingRatio: 1, summary: "", mode: "balanced" },
    ]);
    const checks = refreshNetEffectVerdicts(store, NOW);
    const c = checks.find((c) => c.key === "saver-net-effect");
    expect(c?.pass).toBe(true);
    expect(c?.value).toContain("unknown");
  });
});
```

(Adjust the seeded overlay-event object to satisfy `overlayTokenSaverEventSchema` — copy required fields from `packages/stats/src/event.ts`; drop/adapt fields the schema rejects until the seed parses.)

- [ ] **Step 2: Run, verify FAIL** (`refreshNetEffectVerdicts` not exported)

- [ ] **Step 3: Implement in `doctor-saver.ts`:**

```ts
import { readdirSync } from "node:fs"; // merge into existing fs import
import { estimateNetEffect, overlayTokenSaverEventSchema, sumBytesSavedSince } from "@megasaver/stats";
import { writeNetEffectRecord } from "@megasaver/context-gate";

const NET_EFFECT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Assemble estimator inputs from disk, persist verdicts, return doctor checks.
// Exported for tests. Called from the saver check runner after liveness.
export function refreshNetEffectVerdicts(storeRoot: string, nowIso: string): Check[] {
  const since = Date.parse(nowIso) - NET_EFFECT_WINDOW_MS;
  const statsDir = join(storeRoot, "stats");
  const workspaces: { workspaceKey: string; savedBytesInWindow: number; compressionsInWindow: number }[] = [];
  try {
    for (const wk of readdirSync(statsDir, { withFileTypes: true })) {
      if (!wk.isDirectory()) continue;
      const events: { createdAt: string; bytesSaved: number }[] = [];
      let compressions = 0;
      for (const f of readdirSync(join(statsDir, wk.name))) {
        if (!f.endsWith(".events.jsonl")) continue;
        for (const line of readFileSync(join(statsDir, wk.name, f), "utf8").split("\n")) {
          if (line.trim() === "") continue;
          try {
            const parsed = overlayTokenSaverEventSchema.safeParse(JSON.parse(line));
            if (!parsed.success) continue;
            events.push(parsed.data);
            if (Date.parse(parsed.data.createdAt) >= since) compressions += 1;
          } catch { /* skip bad line */ }
        }
      }
      workspaces.push({
        workspaceKey: wk.name,
        savedBytesInWindow: sumBytesSavedSince(events, since),
        compressionsInWindow: compressions,
      });
    }
  } catch {
    return [{ key: "saver-net-effect", value: "stats dir unreadable", pass: true, reason: "warn: could not assemble net-effect inputs" }];
  }

  const usageRows: { ts: string; cacheCreationTokens: number; messageCount: number }[] = [];
  try {
    for (const line of readFileSync(join(storeRoot, "proxy-usage", "usage.jsonl"), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = JSON.parse(line) as Record<string, unknown>;
        if (
          typeof r["ts"] === "string" &&
          typeof r["cacheCreationTokens"] === "number" &&
          typeof r["messageCount"] === "number"
        ) {
          usageRows.push({
            ts: r["ts"],
            cacheCreationTokens: r["cacheCreationTokens"],
            messageCount: r["messageCount"],
          });
        }
      } catch { /* skip bad line */ }
    }
  } catch { /* no ledger → estimator yields unknown */ }

  const verdicts = estimateNetEffect({ nowIso, workspaces, usageRows });
  const checks: Check[] = [];
  for (const v of verdicts) {
    if (v.savedTokens === 0 && v.churnTokens === 0 && v.verdict === "unknown" ) continue; // idle workspace, no signal
    writeNetEffectRecord(storeRoot, v.workspaceKey, {
      savedTokens: v.savedTokens, churnTokens: v.churnTokens, verdict: v.verdict, updatedAt: nowIso,
    });
    checks.push({
      key: "saver-net-effect",
      value: `${v.verdict} (saved≈${v.savedTokens} vs churn≈${v.churnTokens} tok, 7d, workspace ${v.workspaceKey})`,
      pass: v.verdict !== "negative",
      reason:
        v.verdict === "negative"
          ? "saver auto-paused for this workspace — run: mega session saver resume"
          : v.verdict === "unknown"
            ? "warn: not enough proxied traffic to judge — verdict pending"
            : "net savings positive",
    });
  }
  if (checks.length === 0) {
    checks.push({ key: "saver-net-effect", value: "no compression activity in window", pass: true, reason: "warn: nothing to judge yet" });
  }
  return checks;
}
```

Call it from the saver check runner (same function that pushes the liveness check), appending its result: `checks.push(...refreshNetEffectVerdicts(storeRoot, now()))` — match how `now()`/`storeRoot` are available in that scope (both already exist for the liveness block).

- [ ] **Step 4: Run new test + full doctor tests + typecheck, verify green.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/doctor-saver.ts apps/cli/test/commands/doctor-net-effect.test.ts
git commit -m "feat(cli): doctor computes and persists saver net-effect verdicts"
```

---

### Task 6: Seen-hash ledger (`@megasaver/context-gate`)

**Files:**
- Create: `packages/context-gate/src/saver-seen.ts`
- Modify: `packages/context-gate/src/index.ts`
- Test: `packages/context-gate/test/saver-seen.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/context-gate/test/saver-seen.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToolOutput, hasSeenOutput, recordSeenOutput } from "../src/saver-seen.js";

let store: string;
beforeEach(() => { store = mkdtempSync(join(tmpdir(), "mega-seen-")); });
afterEach(() => rmSync(store, { recursive: true, force: true }));

const WK = "wk1"; const SID = "sess-1";

describe("saver seen-hash ledger", () => {
  it("unseen → false; after record → true; different session → false", () => {
    const h = hashToolOutput("big tool output");
    expect(hasSeenOutput(store, WK, SID, h)).toBe(false);
    recordSeenOutput(store, WK, SID, h);
    expect(hasSeenOutput(store, WK, SID, h)).toBe(true);
    expect(hasSeenOutput(store, WK, "sess-2", h)).toBe(false);
  });

  it("hash is stable for identical content and differs for different content", () => {
    expect(hashToolOutput("a")).toBe(hashToolOutput("a"));
    expect(hashToolOutput("a")).not.toBe(hashToolOutput("b"));
  });

  it("caps the ledger at 500 hashes, evicting oldest first", () => {
    const first = hashToolOutput("first");
    recordSeenOutput(store, WK, SID, first);
    for (let i = 0; i < 500; i++) recordSeenOutput(store, WK, SID, hashToolOutput(`x${i}`));
    expect(hasSeenOutput(store, WK, SID, first)).toBe(false); // evicted
    expect(hasSeenOutput(store, WK, SID, hashToolOutput("x499"))).toBe(true);
  });

  it("corrupt ledger file reads as empty (fail-open: nothing seen)", () => {
    const h = hashToolOutput("a");
    recordSeenOutput(store, WK, SID, h);
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(store, "stats", WK, "saver-seen", `${SID}.json`), "{corrupt");
    expect(hasSeenOutput(store, WK, SID, h)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

```ts
// packages/context-gate/src/saver-seen.ts
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// P1 first-sight ledger: which tool outputs THIS session has already seen.
// A seen output is already in the conversation (and likely in the client's
// prompt cache) — rewriting it would invalidate that cache. Fail-open: any
// read anomaly reports "not seen" (worst case: one redundant compression,
// never a broken tool call). sessionId comes from the hook payload, so files
// are naturally session-scoped and small; a 500-hash FIFO cap bounds them.

const SEEN_CAP = 500;

const seenSchema = z.object({ version: z.literal(1), hashes: z.array(z.string()) });

function seenPath(storeRoot: string, workspaceKey: string, sessionId: string): string {
  return join(storeRoot, "stats", workspaceKey, "saver-seen", `${sessionId}.json`);
}

export function hashToolOutput(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function readHashes(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = seenSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data.hashes : [];
  } catch {
    return [];
  }
}

export function hasSeenOutput(
  storeRoot: string, workspaceKey: string, sessionId: string, hash: string,
): boolean {
  return readHashes(seenPath(storeRoot, workspaceKey, sessionId)).includes(hash);
}

export function recordSeenOutput(
  storeRoot: string, workspaceKey: string, sessionId: string, hash: string,
): void {
  const path = seenPath(storeRoot, workspaceKey, sessionId);
  const hashes = readHashes(path);
  if (!hashes.includes(hash)) hashes.push(hash);
  const capped = hashes.slice(-SEEN_CAP);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify({ version: 1, hashes: capped }));
  renameSync(tmp, path);
}
```

Append to `packages/context-gate/src/index.ts`:

```ts
export { hashToolOutput, hasSeenOutput, recordSeenOutput } from "./saver-seen.js";
```

- [ ] **Step 4: Run tests, verify green.**

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/src/saver-seen.ts packages/context-gate/src/index.ts packages/context-gate/test/saver-seen.test.ts
git commit -m "feat(context-gate): per-session seen-hash ledger for first-sight saver"
```

---

### Task 7: First-sight gate + stable chunk id in the saver

**Files:**
- Modify: `apps/cli/src/hooks/saver.ts` (deps + gate in `decide()` between the floor-bytes gate and `deps.record`, ~line 305)
- Modify: `apps/cli/src/hooks/saver-run.ts` (wire deps)
- Test: `apps/cli/test/hooks/saver.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("second sight of identical output passes through untouched (no rewrite, no churn)", async () => {
  const seen = new Set<string>();
  const d = deps({
    hasSeenOutput: (_s, _w, _sid, h) => seen.has(h),
    recordSeenOutput: (_s, _w, _sid, h) => { seen.add(h); },
  });
  const first = await buildSaverDecision(compressiblePayload(), d);
  expect("updatedToolOutput" in first).toBe(true);
  const second = await buildSaverDecision(compressiblePayload(), d);
  expect(second).toEqual({ passthrough: true });
});

it("chunk-set id derives from content: identical raw output yields an identical id", async () => {
  const recordedIds: string[] = [];
  const d = deps({
    record: async (input) => {
      recordedIds.push(input.newId?.() ?? "missing");
      return { decision: "compressed", returnedText: "compressed" } as never;
    },
  });
  await buildSaverDecision(compressiblePayload(), d);
  const d2 = deps({
    record: async (input) => {
      recordedIds.push(input.newId?.() ?? "missing");
      return { decision: "compressed", returnedText: "compressed" } as never;
    },
  });
  await buildSaverDecision(compressiblePayload(), d2);
  expect(recordedIds[0]).toBe(recordedIds[1]);
  expect(recordedIds[0]).not.toBe("missing");
});
```

(`deps()` helper gains defaults `hasSeenOutput: () => false`, `recordSeenOutput: () => {}` so all existing tests keep passing — update all four saver test files' helpers.)

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** `SaverDeps` additions:

```ts
  // P1 first-sight ledger (fail-open at the store layer).
  hasSeenOutput: (storeRoot: string, workspaceKey: string, sessionId: string, hash: string) => boolean;
  recordSeenOutput: (storeRoot: string, workspaceKey: string, sessionId: string, hash: string) => void;
```

In `decide()`, after the floor-bytes gate (`if (Buffer.byteLength(...) <= floorBytes) return PASSTHROUGH;`):

```ts
  // P1: a seen output is already in the conversation and (likely) in the
  // client's prompt cache — rewriting it now would invalidate that cache and
  // bill the whole prefix as a fresh cache write. First sight only.
  const outputHash = hashToolOutput(shape.raw);
  if (deps.hasSeenOutput(deps.storeRoot, workspaceKey, sessionId, outputHash)) return PASSTHROUGH;
```

In the `deps.record({ ... })` call add one line so the chunk-set id is
content-derived (byte-identical compressions across sessions produce identical
footers — cache-friendly across sessions too):

```ts
    newId: () => `cs-${outputHash.slice(0, 32)}`,
```

After the `if (recorded.decision !== "compressed") return PASSTHROUGH;` line:

```ts
  deps.recordSeenOutput(deps.storeRoot, workspaceKey, sessionId, outputHash);
```

`import { hashToolOutput } from "@megasaver/context-gate";` in saver.ts; wire
`hasSeenOutput` / `recordSeenOutput` from `@megasaver/context-gate` in
saver-run.ts's real deps.

NOTE (mode redefinition, spec §Stage A/P1): no extra code — with this gate,
re-compression is impossible in every mode, so modes now differ only in
first-sight floor/budget (`minBytesFor`). Add one decision-table test asserting
a "seen" output passes through even under `mode: "aggressive"`:

```ts
it("aggressive mode also never rewrites seen output", async () => {
  const d = deps({
    resolveSettings: () => ({ enabled: true, mode: "aggressive" as const }),
    hasSeenOutput: () => true,
  });
  expect(await buildSaverDecision(compressiblePayload(), d)).toEqual({ passthrough: true });
});
```

- [ ] **Step 4: Run all four saver test files + typecheck, verify green.**

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/hooks/saver.ts apps/cli/src/hooks/saver-run.ts apps/cli/test/hooks/
git commit -m "feat(cli): first-sight-only saver with content-derived chunk ids"
```

---

### Task 8: Changeset + full verify

- [ ] **Step 1: Write `.changeset/net-positive-stage-a.md`:**

```markdown
---
"@megasaver/stats": minor
"@megasaver/context-gate": minor
"@megasaver/cli": minor
---

Stage A of Net-Positive MegaSaver: a workspace net-effect estimator
auto-pauses a measurably net-negative saver (doctor computes verdicts;
`mega session saver resume` lifts the pause), and the saver becomes
first-sight-only — an output it has already seen in a session is never
rewritten again, so compression can no longer invalidate Claude Code's
prompt cache. Chunk-set ids derive from content hashes for stable,
cache-friendly footers.
```

- [ ] **Step 2: Run: `pnpm verify`** — Expected: all tasks green. Fix anything red before proceeding (biome format on new files: `pnpm lint:fix`).

- [ ] **Step 3: Commit**

```bash
git add .changeset/net-positive-stage-a.md
git commit -m "chore: changeset for net-positive stage A"
```

---

### Task 9: Stage-A benchmark gate (spec §Goal & gates)

- [ ] **Step 1:** Rebuild + reinstall the global CLI from the worktree branch: `pnpm build && pnpm --filter @megasaver/cli bundle && node apps/cli/scripts/copy-gui-dist.mjs`, then `launchctl kickstart -k "gui/$(id -u)/com.megasaver.proxy"` and confirm `mega proxy status` shows `routed=true` and the listener is up (`lsof -nP -iTCP:8787 -sTCP:LISTEN`).

- [ ] **Step 2:** Run the benchmark TWICE: `MEGA_SAVER_MODE=balanced bash scripts/run-megasaver-claude-limit-test.sh` (each run ≈ $4-8 real usage; results in `/tmp/megasaver-claude-limit-test-results`). Capture both aggregate tables.

- [ ] **Step 3: Gate.** PASS = both runs: cost geomean ≥ 1.0x AND no task < 0.9x. FAIL = stop, attach tables, root-cause before any merge (systematic-debugging).

- [ ] **Step 4:** Append measured tables to `wiki/syntheses/saver-cache-churn.md` under a "Stage A results" heading; add a `wiki/log.md` entry; commit both.

- [ ] **Step 5:** Reviews per spec DoD: `code-reviewer`-equivalent + `critic` (fresh contexts) on `git diff main`; address findings; then merge decision via superpowers:finishing-a-development-branch.

---

## Self-review notes

- Spec coverage: P0 estimator (T1), persistence+pause (T2), decision gate (T3), resume (T4), doctor (T5) — all §Stage A/P0 items. Seen-ledger (T6), first-sight gate + stable ids + mode redefinition (T7) — all §Stage A/P1 items. Gates (T9). Changesets (T8).
- Known adaptation points called out inline: `compressiblePayload()` fixture extraction, `encodeWorkspaceKey` import source, overlay-event seed fields vs schema, sibling-subcommand import style, doctor test file name. Each has an explicit instruction, not a placeholder.
- Type consistency: `saverPaused(storeRoot, workspaceKey, nowIso)` (T3) matches `saverPausedByNetEffect` (T2). `hasSeenOutput`/`recordSeenOutput`/`hashToolOutput` names consistent across T6/T7. `Check` shape `{key, value, pass, reason}` matches doctor-saver.ts usage.
