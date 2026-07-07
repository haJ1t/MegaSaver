# `mega bench` (Pro module 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated top-level `mega bench [--mode m] [--assert] [--md <file>] [--force] [--json] -- <cmd>` that runs a policy-allow-listed command twice (raw, then through `filterOutput`), and reports tokens saved, wall-time overhead, and an exit+classified-signal parity verdict — recording NOTHING.

**Architecture:** Reuse over replication: context-gate's private `runChild` (timeout/max-bytes/kill-grace child capture) gets EXPORTED; the CLI composes entitlement gate → `evaluateCommand` policy gate → pass B (raw spawn) → pass A (spawn + unpersisted `filterOutput`, `recordTrace: false`) → pure `composeBenchReport`/`renderBenchMarkdown` in `@megasaver/pro-analytics`. No events, chunk sets, traces, or saver records are ever written.

**Tech Stack:** TypeScript strict ESM, Vitest, Citty. Spec: `docs/superpowers/specs/2026-07-07-bench-design.md` (risk HIGH).

**Execution notes:**
- Feature worktree, branch `feat/cli-bench`.
- Fresh-worktree traps: `pnpm --filter @megasaver/gui build` before full CLI suites; `pnpm --filter @megasaver/pro-analytics build` (and now also `pnpm --filter @megasaver/context-gate build`) before CLI tests that import new exports.
- Release ritual reminder (for the eventual 1.9.0): `changeset version` → stage the consumed `.changeset/*.md` deletions → `lint:fix apps/cli/package.json`.
- Pinned APIs: `evaluateCommand({command, args, project, env, permissions?})` → `{allowed} | {allowed:false, reason: PolicyDenyCode}` (@megasaver/policy); `runChild` semantics in `packages/context-gate/src/run-command.ts:110-196`; `classifyOutput({command?, text})` → `{category, confidence}` + `isConfidentClassification` (@megasaver/output-filter); `filterOutput({raw, intent, mode, maxReturnedBytes?, source, engineRanking, recordTrace, ...})`; `modeToBudget`, `tokenSaverModeSchema` (@megasaver/shared); `tokensFromBytes`, `INPUT_PRICE_PER_MTOK_USD` (@megasaver/stats).

---

### Task 1: export `runChild` from context-gate

**Files:**
- Modify: `packages/context-gate/src/run-command.ts` (export keyword + types)
- Modify: `packages/context-gate/src/index.ts`
- Test: existing `packages/context-gate/test` suite is the regression net (no behavior change)

- [ ] **Step 1: Export the function and its types**

In `packages/context-gate/src/run-command.ts`, change the private declarations to exported ones (NO body changes):

```ts
export type Capture = {
  raw: string;
  terminated?: "timeout" | "max_bytes";
  childExitCode: number | null;
};

export type SpawnOutcome =
  | { ok: true; capture: Capture }
  | { ok: false; reason: "command_failed"; detail: string };
```

and `function runChild(` → `export function runChild(`. Add one WHY line above `runChild`'s existing comment block:

```ts
// Exported for `mega bench` (module 7): the paired benchmark reuses this exact
// capture (timeout/max-bytes/kill-grace) instead of replicating it.
```

- [ ] **Step 2: Re-export from the package index**

In `packages/context-gate/src/index.ts`, extend the existing `./run-command.js` export block with `type Capture`, `type SpawnOutcome`, `type RunCommandSpawn`, and `runChild` (find the block that already exports `runOutputExecCommand` and add them there, matching its style).

- [ ] **Step 3: Regression + gates**

Run: `pnpm --filter @megasaver/context-gate test && pnpm --filter @megasaver/context-gate typecheck && pnpm lint`
Expected: all green — the diff is export-surface only.

- [ ] **Step 4: Commit**

```bash
git add packages/context-gate/src/run-command.ts packages/context-gate/src/index.ts
git commit -m "feat(context-gate): export runChild for the paired benchmark"
```

---

### Task 2: pure bench engine (TDD)

**Files:**
- Create: `packages/pro-analytics/test/bench.test.ts`
- Create: `packages/pro-analytics/src/bench.ts`
- Modify: `packages/pro-analytics/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pro-analytics/test/bench.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type BenchPass, composeBenchReport, renderBenchMarkdown } from "../src/bench.js";

function pass(over: Partial<BenchPass> = {}): BenchPass {
  return {
    kind: "raw",
    exitCode: 0,
    wallMs: 1_000,
    rawBytes: 4_000_000,
    returnedBytes: null,
    savingRatio: null,
    signal: "vitest",
    ...over,
  };
}

const RAW = pass();
const SAVER = pass({
  kind: "saver",
  wallMs: 1_200,
  returnedBytes: 400_000,
  savingRatio: 0.9,
});

describe("composeBenchReport — parity matrix", () => {
  it("everything matches → ok", () => {
    const r = composeBenchReport("pnpm test", RAW, SAVER);
    expect(r.parity).toEqual({ exitMatch: true, signalMatch: true, ok: true, note: null });
  });

  it("exit differs → broken with nondeterminism note", () => {
    const r = composeBenchReport("pnpm test", RAW, pass({ ...SAVER, exitCode: 1 }));
    expect(r.parity.exitMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
    expect(r.parity.note).toContain("nondeterministic");
  });

  it("signal differs → broken", () => {
    const r = composeBenchReport("pnpm test", RAW, pass({ ...SAVER, signal: "typescript" }));
    expect(r.parity.signalMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
  });

  it("both signals unknown → exit-code-only parity with honesty note", () => {
    const r = composeBenchReport(
      "some-tool",
      pass({ signal: null }),
      pass({ ...SAVER, signal: null }),
    );
    expect(r.parity.signalMatch).toBeNull();
    expect(r.parity.ok).toBe(true);
    expect(r.parity.note).toContain("exit code only");
  });

  it("one unknown, one known → signalMatch false, broken", () => {
    const r = composeBenchReport("pnpm test", pass({ signal: null }), SAVER);
    expect(r.parity.signalMatch).toBe(false);
    expect(r.parity.ok).toBe(false);
  });

  it("either pass incomplete (exitCode null) → no parity claim", () => {
    const r = composeBenchReport("pnpm test", pass({ exitCode: null }), SAVER);
    expect(r.parity.ok).toBe(false);
    expect(r.parity.note).toContain("did not complete");
  });
});

describe("composeBenchReport — math", () => {
  it("token and dollar math from bytes", () => {
    const r = composeBenchReport("pnpm test", RAW, SAVER);
    expect(r.tokensRaw).toBe(1_000_000); // ceil(4_000_000/4)
    expect(r.tokensReturned).toBe(100_000); // ceil(400_000/4)
    expect(r.tokensSaved).toBe(900_000);
    expect(r.dollarsSaved).toBeCloseTo(2.7); // 900k tokens at $3/MTok
  });

  it("overhead incl. negative, and raw.wallMs=0 guard", () => {
    const r = composeBenchReport("x", RAW, SAVER);
    expect(r.overheadMs).toBe(200);
    expect(r.overheadPct).toBeCloseTo(0.2);
    const faster = composeBenchReport("x", RAW, pass({ ...SAVER, wallMs: 900 }));
    expect(faster.overheadMs).toBe(-100);
    const zero = composeBenchReport("x", pass({ wallMs: 0 }), SAVER);
    expect(zero.overheadPct).toBe(0);
    expect(Number.isFinite(zero.overheadPct)).toBe(true);
  });

  it("saver pass missing returnedBytes falls back to its rawBytes (no savings claimed)", () => {
    const r = composeBenchReport("x", RAW, pass({ kind: "saver", returnedBytes: null }));
    expect(r.tokensReturned).toBe(r.tokensRaw);
    expect(r.tokensSaved).toBe(0);
  });
});

describe("renderBenchMarkdown", () => {
  const md = renderBenchMarkdown(composeBenchReport("pnpm test --run", RAW, SAVER));

  it("renders the fixed sections, ordering disclosure, and (est.) discipline", () => {
    for (const h of [
      "# Same command, twice — a Mega Saver bench",
      "## The pair",
      "## Tokens",
      "## Time",
      "## Outcome parity",
      "## Methodology",
    ]) {
      expect(md).toContain(h);
    }
    expect(md).toContain("pnpm test --run");
    expect(md).toContain("(est.)");
    expect(md).toContain("$3");
    expect(md).toContain("raw first, then saver");
    expect(md).toContain("single pair");
  });

  it("a signal with markdown metacharacters renders inside inline code", () => {
    const hostile = composeBenchReport(
      "x",
      pass({ signal: "weird|sig`nal`" }),
      pass({ ...SAVER, signal: "weird|sig`nal`" }),
    );
    const out = renderBenchMarkdown(hostile);
    expect(out).toContain("weird|sig");
    expect(out).not.toContain("``nal``"); // no broken fencing — renderer wraps signals predictably
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/bench.test.ts`
Expected: FAIL — cannot resolve `../src/bench.js`.

- [ ] **Step 3: Implement**

Create `packages/pro-analytics/src/bench.ts`:

```ts
import { INPUT_PRICE_PER_MTOK_USD, tokensFromBytes } from "@megasaver/stats";

export interface BenchPass {
  kind: "raw" | "saver";
  exitCode: number | null;
  wallMs: number;
  rawBytes: number;
  returnedBytes: number | null;
  savingRatio: number | null;
  signal: string | null;
}

export interface BenchParity {
  exitMatch: boolean;
  signalMatch: boolean | null;
  ok: boolean;
  note: string | null;
}

export interface BenchReport {
  command: string;
  raw: BenchPass;
  saver: BenchPass;
  tokensRaw: number;
  tokensReturned: number;
  tokensSaved: number;
  dollarsSaved: number;
  overheadMs: number;
  overheadPct: number;
  parity: BenchParity;
}

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

export function composeBenchReport(
  command: string,
  raw: BenchPass,
  saver: BenchPass,
): BenchReport {
  const incomplete = raw.exitCode === null || saver.exitCode === null;
  const exitMatch = !incomplete && raw.exitCode === saver.exitCode;
  const signalMatch =
    raw.signal === null && saver.signal === null ? null : raw.signal === saver.signal;
  const ok = !incomplete && exitMatch && signalMatch !== false;
  let note: string | null = null;
  if (incomplete) {
    note = "a run did not complete (spawn failure or timeout) — no parity claim";
  } else if (!ok) {
    note = "parity broken — the command may be nondeterministic; re-run to confirm";
  } else if (signalMatch === null) {
    note = "outcome compared by exit code only (output not classifiable)";
  }

  const tokensRaw = tokensFromBytes(raw.rawBytes);
  const tokensReturned = tokensFromBytes(saver.returnedBytes ?? saver.rawBytes);
  const tokensSaved = Math.max(0, tokensRaw - tokensReturned);
  const overheadMs = saver.wallMs - raw.wallMs;
  return {
    command,
    raw,
    saver,
    tokensRaw,
    tokensReturned,
    tokensSaved,
    dollarsSaved: dollarsFromTokens(tokensSaved),
    overheadMs,
    overheadPct: raw.wallMs === 0 ? 0 : overheadMs / raw.wallMs,
    parity: { exitMatch, signalMatch, ok, note },
  };
}

function money(n: number): string {
  return `$${n.toFixed(2)} (est.)`;
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function ms(n: number): string {
  return `${Math.round(n)}ms`;
}

// Signals are classifier labels (closed vocabulary), but render them inside
// inline code with pipe-safe spacing so a future label can't break the table.
function sig(s: string | null): string {
  return s === null ? "unknown" : `\`${s.replace(/`/g, "'")}\``;
}

export function renderBenchMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("# Same command, twice — a Mega Saver bench");
  lines.push("");
  lines.push("## The pair");
  lines.push("");
  lines.push(`Command: \`${report.command}\``);
  lines.push("");
  lines.push("Order: raw first, then saver (fixed; a warm OS cache may slightly favor the second run).");
  lines.push("");
  lines.push("## Tokens");
  lines.push("");
  lines.push(`| pass | bytes captured | tokens |`);
  lines.push(`|---|---|---|`);
  lines.push(`| raw | ${report.raw.rawBytes} | ${compactTokens(report.tokensRaw)} |`);
  lines.push(
    `| saver | ${report.saver.returnedBytes ?? report.saver.rawBytes} returned | ${compactTokens(report.tokensReturned)} |`,
  );
  lines.push("");
  lines.push(
    `Kept out of context: **${compactTokens(report.tokensSaved)} tokens ≈ ${money(report.dollarsSaved)}** per run.`,
  );
  lines.push("");
  lines.push("## Time");
  lines.push("");
  lines.push(
    `raw ${ms(report.raw.wallMs)} · saver ${ms(report.saver.wallMs)} · overhead ${ms(report.overheadMs)} (${(report.overheadPct * 100).toFixed(0)}%)`,
  );
  lines.push("");
  lines.push("## Outcome parity");
  lines.push("");
  lines.push(
    `**${report.parity.ok ? "PARITY OK" : "PARITY NOT CONFIRMED"}** · exit ${report.raw.exitCode} vs ${report.saver.exitCode} · signal ${sig(report.raw.signal)} vs ${sig(report.saver.signal)}`,
  );
  if (report.parity.note !== null) {
    lines.push("");
    lines.push(`Note: ${report.parity.note}`);
  }
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    `Dollar figures use a flat $${INPUT_PRICE_PER_MTOK_USD}/MTok input price and are estimates; tokens are byte-derived (≈4 bytes/token). Measured, not modeled — a single pair on this machine, raw first, then saver. Tool output content never appears in this report.`,
  );
  lines.push("");
  return lines.join("\n");
}
```

Append to `packages/pro-analytics/src/index.ts`:

```ts
export {
  type BenchParity,
  type BenchPass,
  type BenchReport,
  composeBenchReport,
  renderBenchMarkdown,
} from "./bench.js";
```

- [ ] **Step 4: GREEN + gates**

Run: `pnpm --filter @megasaver/pro-analytics exec vitest run test/bench.test.ts && pnpm --filter @megasaver/pro-analytics test && pnpm --filter @megasaver/pro-analytics typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/pro-analytics/src/bench.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/bench.test.ts
git commit -m "feat(pro-analytics): bench report engine"
```

---

### Task 3: gated `runBench` CLI (TDD)

**Files:**
- Create: `apps/cli/test/commands/bench.test.ts`
- Create: `apps/cli/src/commands/bench.ts`

- [ ] **Step 1: Read the type surfaces you will call (5 minutes, before writing code)**

Read `packages/output-filter/src/types.ts` around `filterOutput` (line ~165) and note the exact `FilterOutputResult` field carrying returned size (use the REAL field; if only `savingRatio` exists, derive `returnedBytes = Math.round(rawBytes * (1 - savingRatio))` and note it in your report). Read `packages/context-gate/src/run-command.ts:214-233` — the `evaluateCommand` call shape and `runChild` call shape you will mirror.

- [ ] **Step 2: Write the failing test**

Create `apps/cli/test/commands/bench.test.ts` (license harness mirrors `teardown.test.ts`; the spawner is injected — NO real process is ever spawned in tests):

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BenchPassResult, runBench } from "../../src/commands/bench.js";

const proSpies = vi.hoisted(() => ({ composeBenchReport: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.composeBenchReport.mockImplementation(actual.composeBenchReport);
  return { ...actual, composeBenchReport: proSpies.composeBenchReport };
});

// The no-recording invariant, pinned: bench must NEVER persist chunk sets or
// append events, on any path.
const persistSpies = vi.hoisted(() => ({ saveChunkSet: vi.fn(), appendEvent: vi.fn() }));

vi.mock("@megasaver/content-store", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/content-store")>();
  persistSpies.saveChunkSet.mockImplementation(actual.saveChunkSet);
  return { ...actual, saveChunkSet: persistSpies.saveChunkSet };
});

vi.mock("@megasaver/stats", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/stats")>();
  persistSpies.appendEvent.mockImplementation(actual.appendEvent);
  return { ...actual, appendEvent: persistSpies.appendEvent };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const s = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(s)}`;
}
const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-bench-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.composeBenchReport.mockClear();
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

// Deterministic fake pass runner: first call = raw pass, second = saver pass.
function fakeRunner(
  results: [BenchPassResult, BenchPassResult],
): { runner: (opts: unknown) => Promise<BenchPassResult>; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    runner: async (opts: unknown) => {
      calls.push(opts);
      const r = results[Math.min(calls.length - 1, 1) as 0 | 1];
      return r;
    },
  };
}

const RAW_OK: BenchPassResult = { exitCode: 0, wallMs: 100, output: "3 passed (3)" };
const SAVER_OK: BenchPassResult = { exitCode: 0, wallMs: 120, output: "3 passed (3)" };

function baseInput(over: Partial<Parameters<typeof runBench>[0]> = {}) {
  const { runner, calls } = fakeRunner([RAW_OK, SAVER_OK]);
  const writeFile = vi.fn();
  return {
    calls,
    writeFile,
    input: {
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      command: "vitest",
      commandArgs: ["run"] as readonly string[],
      cwd: root,
      originPid: "1",
      evaluate: () => ({ allowed: true }) as const,
      runPass: runner,
      mode: "balanced" as const,
      writeFile,
      fileExists: () => false,
      stdout,
      stderr,
      ...over,
    },
  };
}

describe("runBench — gating", () => {
  it.each([{}, { json: true }, { assert: true }, { md: "bench.md" }])(
    "with NO license (%o): upsell, exit 0, no policy eval, no spawn, no write",
    async (flags) => {
      const evaluate = vi.fn(() => ({ allowed: true }) as const);
      const { input, calls, writeFile } = baseInput({ evaluate, ...flags });
      const code = await runBench(input);

      expect(code).toBe(0);
      expect(out.join("\n")).toContain("Mega Saver Pro");
      expect(evaluate).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
      expect(writeFile).not.toHaveBeenCalled();
      expect(proSpies.composeBenchReport).not.toHaveBeenCalled();
    },
  );
});

describe("runBench — policy gate (entitled)", () => {
  beforeEach(() => activatePro());

  it("denied command → honest message, exit 1, spawner never called", async () => {
    const { input, calls } = baseInput({
      evaluate: () => ({ allowed: false, reason: "command_not_allowed" }) as const,
    });
    const code = await runBench(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("command_not_allowed");
    expect(calls).toHaveLength(0);
    expect(proSpies.composeBenchReport).not.toHaveBeenCalled();
  });
});

describe("runBench — paired run (entitled)", () => {
  beforeEach(() => activatePro());

  it("runs raw then saver, prints the parity table, exit 0", async () => {
    const { input, calls } = baseInput();
    const code = await runBench(input);

    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    const text = out.join("\n");
    expect(text).toContain("PARITY OK");
    expect(text).toContain("(est.)");
    // No-recording invariant: nothing persisted on the full happy path.
    expect(persistSpies.saveChunkSet).not.toHaveBeenCalled();
    expect(persistSpies.appendEvent).not.toHaveBeenCalled();
  });

  it("--json emits a BenchReport", async () => {
    const { input } = baseInput({ json: true });
    const code = await runBench(input);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      parity: { ok: boolean };
      tokensRaw: number;
    };
    expect(parsed.parity.ok).toBe(true);
    expect(parsed.tokensRaw).toBeGreaterThan(0);
  });

  it("--assert with parity broken → exit 1 (report still printed)", async () => {
    const { runner } = fakeRunner([RAW_OK, { ...SAVER_OK, exitCode: 1 }]);
    const { input } = baseInput({ assert: true, runPass: runner });
    const code = await runBench(input);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("PARITY NOT CONFIRMED");
  });

  it("--assert with parity ok → exit 0", async () => {
    const { input } = baseInput({ assert: true });
    expect(await runBench(input)).toBe(0);
  });

  it("--md writes behind the exists-guard; --force overwrites", async () => {
    const first = baseInput({ md: "bench.md" });
    expect(await runBench(first.input)).toBe(0);
    expect(first.writeFile).toHaveBeenCalledTimes(1);

    out.length = 0;
    const guarded = baseInput({ md: "bench.md", fileExists: () => true });
    expect(await runBench(guarded.input)).toBe(1);
    expect(err.join("\n")).toContain("--force");
    expect(guarded.writeFile).not.toHaveBeenCalled();

    const forced = baseInput({ md: "bench.md", fileExists: () => true, force: true });
    expect(await runBench(forced.input)).toBe(0);
    expect(forced.writeFile).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: RED**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/bench.test.ts`
Expected: FAIL on module resolution (rebuild context-gate + pro-analytics dists first if stale: `pnpm --filter @megasaver/context-gate build && pnpm --filter @megasaver/pro-analytics build`).

- [ ] **Step 4: Implement**

Create `apps/cli/src/commands/bench.ts`:

```ts
import type { KeyObject } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  loadProjectPermissions,
  runChild,
} from "@megasaver/context-gate";
import { checkEntitlement } from "@megasaver/entitlement";
import {
  classifyOutput,
  filterOutput,
  isConfidentClassification,
} from "@megasaver/output-filter";
import { type EvaluateCommandResult, evaluateCommand } from "@megasaver/policy";
import { type TokenSaverMode, modeToBudget, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

// bench-specific upsell (shared strings would misname the feature).
export const BENCH_UPSELL = `The paired benchmark is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

// Same bounds as `mega output exec` (spec: bench never exceeds exec's powers).
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 20_000_000;

export type BenchPassResult = {
  exitCode: number | null;
  wallMs: number;
  output: string;
  terminated?: "timeout" | "max_bytes";
};

export type BenchPassRunner = (opts: {
  command: string;
  args: readonly string[];
  cwd: string;
  originPid: string;
}) => Promise<BenchPassResult>;

export function defaultBenchPassRunner(): BenchPassRunner {
  return async (opts) => {
    const started = performance.now();
    const outcome = await runChild({
      spawn: nodeSpawn,
      command: opts.command,
      args: opts.args,
      cwd: opts.cwd,
      originPid: opts.originPid,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_BYTES,
    });
    const wallMs = performance.now() - started;
    if (!outcome.ok) return { exitCode: null, wallMs, output: "" };
    return {
      exitCode: outcome.capture.childExitCode,
      wallMs,
      output: outcome.capture.raw,
      ...(outcome.capture.terminated !== undefined
        ? { terminated: outcome.capture.terminated }
        : {}),
    };
  };
}

export type BenchEvaluate = (input: {
  command: string;
  args: readonly string[];
  originPid: string;
}) => EvaluateCommandResult;

export function defaultBenchEvaluate(cwd: string): BenchEvaluate {
  // Mirrors run-command.ts's gate: tighten-only project permissions plus the
  // global allow-list; the recursive_megasaver conjunct rides on originPid.
  const permissions = loadProjectPermissions(cwd);
  return ({ command, args, originPid }) =>
    evaluateCommand({
      command,
      args,
      project: "bench" as never,
      env: { MEGASAVER_ORIGIN_PID: originPid },
      ...(permissions !== null ? { permissions } : {}),
    });
}

export type RunBenchInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  command: string;
  commandArgs: readonly string[];
  cwd: string;
  originPid: string;
  evaluate: BenchEvaluate;
  runPass: BenchPassRunner;
  mode: TokenSaverMode;
  md?: string;
  force?: boolean;
  assert?: boolean;
  json?: boolean;
  writeFile: (path: string, content: string) => void;
  fileExists: (path: string) => boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function signalOf(command: string, args: readonly string[], text: string): string | null {
  const c = classifyOutput({ command: [command, ...args].join(" "), text });
  return isConfidentClassification(c) ? c.category : null;
}

export async function runBench(input: RunBenchInput): Promise<0 | 1> {
  // Entitlement FIRST: the free path evaluates no policy, spawns nothing,
  // writes nothing (spy-enforced).
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(BENCH_UPSELL);
    return 0;
  }

  if (input.command === "") {
    input.stderr("usage: mega bench [flags] -- <command> [args...]");
    return 1;
  }

  // Policy gate BEFORE any spawn — bench can never run what exec couldn't.
  const verdict = input.evaluate({
    command: input.command,
    args: input.commandArgs,
    originPid: input.originPid,
  });
  if (!verdict.allowed) {
    input.stderr(`command denied: ${verdict.reason}`);
    return 1;
  }

  const { composeBenchReport, renderBenchMarkdown } = await import("@megasaver/pro-analytics");

  // Fixed order: raw first, then saver (disclosed in the report).
  const rawRun = await input.runPass({
    command: input.command,
    args: input.commandArgs,
    cwd: input.cwd,
    originPid: input.originPid,
  });
  const saverRun = await input.runPass({
    command: input.command,
    args: input.commandArgs,
    cwd: input.cwd,
    originPid: input.originPid,
  });

  // The saver pass filters its capture (unpersisted; recordTrace off — bench
  // must write NOTHING), timed as part of the pass.
  const filterStart = performance.now();
  const filtered = await filterOutput({
    raw: saverRun.output,
    intent: "bench parity check",
    mode: input.mode,
    maxReturnedBytes: modeToBudget(input.mode),
    source: { kind: "command", command: input.command, args: [...input.commandArgs] },
    engineRanking: false,
    recordTrace: false,
  });
  const filterMs = performance.now() - filterStart;
  const rawBytesSaver = Buffer.byteLength(saverRun.output, "utf8");
  // Step-1 note applies here: use FilterOutputResult's real returned-size field
  // if it exists; the ratio derivation below is the documented fallback.
  const returnedBytes = Math.round(rawBytesSaver * (1 - filtered.savingRatio));

  const report = composeBenchReport(
    [input.command, ...input.commandArgs].join(" "),
    {
      kind: "raw",
      exitCode: rawRun.exitCode,
      wallMs: rawRun.wallMs,
      rawBytes: Buffer.byteLength(rawRun.output, "utf8"),
      returnedBytes: null,
      savingRatio: null,
      signal: signalOf(input.command, input.commandArgs, rawRun.output),
    },
    {
      kind: "saver",
      exitCode: saverRun.exitCode,
      wallMs: saverRun.wallMs + filterMs,
      rawBytes: rawBytesSaver,
      returnedBytes,
      savingRatio: filtered.savingRatio,
      signal: signalOf(input.command, input.commandArgs, saverRun.output),
    },
  );

  if (input.json) {
    input.stdout(JSON.stringify(report));
  } else {
    input.stdout(
      `bench: ${report.command} · mode ${input.mode} · raw first, then saver`,
    );
    input.stdout(
      `tokens: raw ${report.tokensRaw} → returned ${report.tokensReturned} · saved ${report.tokensSaved} ($${report.dollarsSaved.toFixed(2)} (est.))`,
    );
    input.stdout(
      `time: raw ${Math.round(report.raw.wallMs)}ms · saver ${Math.round(report.saver.wallMs)}ms · overhead ${Math.round(report.overheadMs)}ms`,
    );
    input.stdout(
      `parity: ${report.parity.ok ? "PARITY OK" : "PARITY NOT CONFIRMED"} (exit ${report.raw.exitCode} vs ${report.saver.exitCode}, signal ${report.raw.signal ?? "unknown"} vs ${report.saver.signal ?? "unknown"})`,
    );
    if (report.parity.note !== null) input.stdout(`note: ${report.parity.note}`);
  }

  if (input.md !== undefined) {
    const mdPath = resolve(input.cwd, input.md);
    if (input.fileExists(mdPath) && input.force !== true) {
      input.stderr(`refusing to overwrite ${mdPath} (use --force)`);
      return 1;
    }
    input.writeFile(mdPath, renderBenchMarkdown(report));
    input.stdout(`wrote ${mdPath}`);
  }

  if (input.assert === true && !report.parity.ok) return 1;
  return 0;
}

export const benchCommand = defineCommand({
  meta: {
    name: "bench",
    description:
      "Run a command twice — raw and through the saver — and report tokens, time, and outcome parity (Mega Saver Pro).",
  },
  args: {
    mode: {
      type: "string",
      description: "Saver mode for the filtered pass: safe | balanced | aggressive (default: balanced).",
    },
    md: { type: "string", description: "Write a shareable markdown report to this file." },
    force: { type: "boolean", default: false, description: "Overwrite an existing --md file." },
    assert: { type: "boolean", default: false, description: "Exit 1 when outcome parity is broken (CI gate)." },
    json: { type: "boolean", default: false, description: "Emit the report as JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const cwd = process.cwd();
    const positionals = (args._ ?? []).map(String);
    const mode = tokenSaverModeSchema.safeParse(args.mode ?? "balanced");
    if (!mode.success) {
      console.error(
        `error: invalid mode "${String(args.mode)}" (${tokenSaverModeSchema.options.join(" | ")})`,
      );
      process.exitCode = 1;
      return;
    }
    const originPid = process.env.MEGASAVER_ORIGIN_PID ?? String(process.pid);
    const code = await runBench({
      storeRoot: resolveStorePath(storeInput),
      now: () => Date.now(),
      command: positionals[0] ?? "",
      commandArgs: positionals.slice(1),
      cwd,
      originPid,
      evaluate: defaultBenchEvaluate(cwd),
      runPass: defaultBenchPassRunner(),
      mode: mode.data,
      ...(typeof args.md === "string" ? { md: args.md } : {}),
      force: !!args.force,
      assert: !!args.assert,
      json: !!args.json,
      writeFile: (p, c) => writeFileSync(p, c),
      fileExists: (p) => existsSync(p),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

VERIFY during implementation (Step-1 findings apply): the `filterOutput`
input fields (`engineRanking`, `recordTrace`, `maxReturnedBytes`, `source`)
and `EvaluateCommandResult` import — adjust to the REAL types if any name
differs, and report the delta. The `project: "bench" as never` follows
run-command.ts's own precedent (`OVERLAY_COMMAND_PROJECT` — evaluateCommand
never reads the field).

- [ ] **Step 5: GREEN + gates**

Run: `pnpm --filter @megasaver/cli exec vitest run test/commands/bench.test.ts && pnpm --filter @megasaver/cli typecheck && pnpm lint`
Expected: all green (4 gating variants + 1 policy + 5 paired-run tests).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/bench.ts apps/cli/test/commands/bench.test.ts
git commit -m "feat(cli): mega bench — paired saver benchmark (gated)"
```

---

### Task 4: register + README + changeset

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `README.md`
- Create: `.changeset/bench.md`

- [ ] **Step 1:** Register `import { benchCommand } from "./commands/bench.js";` + `bench: benchCommand,` (alphabetical slots).

- [ ] **Step 2:** README — command-table row after the `mega teardown` row:

```md
| `mega bench` | paired saver on/off run — tokens, time, outcome parity (Pro) |
```

Pro code block after the teardown lines:

```sh

mega bench -- pnpm test           # same command, raw vs saver (Pro)
mega bench --assert --md bench.md -- pnpm test
```

Bullet after the teardown bullet:

```md
- `mega bench [--mode m] [--assert] [--md <file>] [--json] -- <cmd>` — runs
  the command twice (raw, then through the saver pipeline) and reports
  tokens kept out of context, wall-time overhead, and an outcome-parity
  verdict (exit code + classified output signal). Records nothing — bench
  runs never touch your savings analytics. The command must pass the same
  policy allow-list as `mega output exec`, and it DOES run twice — avoid
  side-effecting commands. `--assert` exits 1 on broken parity (CI gate).
```

- [ ] **Step 3:** `.changeset/bench.md`:

```md
---
"@megasaver/cli": minor
---

`mega bench` — runs a command twice (raw vs saver pipeline) and reports
tokens kept out of context, wall-time overhead, and an outcome-parity
verdict; `--assert` turns it into a CI regression gate. Records nothing.
```

- [ ] **Step 4:** Full CLI suite + help check (`node apps/cli/dist/cli.js --help | grep -i bench` after build). Both typecheck halves + `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/main.ts README.md .changeset/bench.md
git commit -m "feat(cli): register mega bench + README + changeset"
```

---

### Task 5: verification + smoke + reviews (HIGH gates)

- [ ] **Step 1:** `TURBO_FORCE=true pnpm verify` → all green.

- [ ] **Step 2: E2E smoke** (temp store; license via
`node scripts/license/issue.mjs <id> --exp <tomorrow> --priv /Users/halitozger/Desktop/MegaSaver/scripts/license/.private-key.pem`; never log the key):
free → upsell; activate → find an ALLOWED_COMMANDS member (read
`packages/policy/src/evaluate-command.ts` — e.g. `node` if listed) and run
`mega bench -- <allowed-cmd> ...` → report with PARITY OK; `--assert` exit
0; a NON-allow-listed command → `command denied: command_not_allowed` exit
1; `--md` file written + exists-guard on rerun; `--json` valid.

- [ ] **Step 3: Reviews (HIGH)** — per-task spec+quality reviews ran
task-by-task; finish with the 3-lens holistic final (the critic attacks:
double-spawn side-effect disclosure, the no-recording invariant on EVERY
path — no events/chunks/traces/saver records, gate ordering
entitlement→policy→spawn, timing fairness claims, --assert semantics),
then `superpowers:finishing-a-development-branch`.
