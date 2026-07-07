import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BenchPassResult, defaultBenchEvaluate, runBench } from "../../src/commands/bench.js";

const proSpies = vi.hoisted(() => ({ composeBenchReport: vi.fn() }));

vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.composeBenchReport.mockImplementation(actual.composeBenchReport);
  return { ...actual, composeBenchReport: proSpies.composeBenchReport };
});

// The no-recording invariant, pinned: bench must NEVER persist chunk sets or
// traces, on any path. (Event appends go through @megasaver/core internals and
// stats — a forbidden CLI dependency — so they are unreachable from this
// command and cannot be spied at the CLI boundary; the chunk-store spy is the
// resolvable persistence surface bench transitively touches.)
const persistSpies = vi.hoisted(() => ({ saveChunkSet: vi.fn() }));

vi.mock("@megasaver/content-store", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/content-store")>();
  persistSpies.saveChunkSet.mockImplementation(actual.saveChunkSet);
  return { ...actual, saveChunkSet: persistSpies.saveChunkSet };
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
function fakeRunner(results: [BenchPassResult, BenchPassResult]): {
  runner: (opts: unknown) => Promise<BenchPassResult>;
  calls: unknown[];
} {
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

// DISTINCT sizes pin raw/saver attribution: a swapped assignment or
// filtering-the-wrong-pass mutation dies on the byte assertions below.
// Outputs AND command are classify-neutral (no vitest/ts/diff anchors —
// classifyOutput matches the command string too), so parity is exit-code-only.
const RAW_OK: BenchPassResult = { exitCode: 0, wallMs: 100, output: "x".repeat(40_000) };
const SAVER_OK: BenchPassResult = { exitCode: 0, wallMs: 120, output: "ok" };

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
      command: "sometool",
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

  it("free path + malformed permissions.yaml → upsell, exit 0, no crash", async () => {
    // Reproduces the eager-load crash: constructing the default evaluator
    // must not touch policy IO — a broken yaml is only a Pro-path concern.
    mkdirSync(join(root, ".megasaver"), { recursive: true });
    writeFileSync(join(root, ".megasaver", "permissions.yaml"), "{{{{");
    const { input } = baseInput({ evaluate: defaultBenchEvaluate(root) });
    const code = await runBench(input);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Mega Saver Pro");
  });

  it("free path never invokes the permissions loader (lazy)", async () => {
    const loader = vi.fn(() => {
      throw new Error("boom");
    });
    const { input } = baseInput({ evaluate: defaultBenchEvaluate(root, loader) });

    expect(await runBench(input)).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("runBench — policy gate (entitled)", () => {
  beforeEach(() => activatePro());

  it("denied command → shared denial message, exit 1, spawner never called", async () => {
    const { input, calls } = baseInput({
      evaluate: () => ({ allowed: false, reason: "command_not_allowed" }) as const,
    });
    const code = await runBench(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("command_denied");
    expect(err.join("\n")).toContain("command_not_allowed");
    expect(calls).toHaveLength(0);
    expect(proSpies.composeBenchReport).not.toHaveBeenCalled();
  });

  it("empty command → usage, exit 1, nothing run", async () => {
    const { input, calls } = baseInput({ command: "" });
    const code = await runBench(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("usage: mega bench");
    expect(calls).toHaveLength(0);
  });

  it("throwing permissions loader → fail-closed policy_load_failed, exit 1, no spawn", async () => {
    const loader = vi.fn(() => {
      throw new Error("boom");
    });
    const { input, calls } = baseInput({ evaluate: defaultBenchEvaluate(root, loader) });
    const code = await runBench(input);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("policy_load_failed");
    expect(calls).toHaveLength(0);
    expect(proSpies.composeBenchReport).not.toHaveBeenCalled();
  });
});

describe("runBench — paired run (entitled)", () => {
  beforeEach(() => activatePro());

  it("runs raw then saver, prints the parity table with positive savings, exit 0", async () => {
    const { input, calls } = baseInput();
    const code = await runBench(input);

    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    const text = out.join("\n");
    expect(text).toContain("PARITY OK");
    expect(text).toContain("exit code only"); // neutral outputs → exit-code-only honesty note
    expect(text).toContain("(est.)");
    expect(text).toMatch(/saved [1-9]/); // 40k raw vs tiny filtered return → real savings
    // No-recording invariant: nothing persisted on the full happy path.
    expect(persistSpies.saveChunkSet).not.toHaveBeenCalled();
  });

  it("--json emits a BenchReport with per-pass attribution pinned", async () => {
    const { input } = baseInput({ json: true });
    const code = await runBench(input);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as {
      parity: { ok: boolean };
      tokensRaw: number;
      raw: { rawBytes: number };
      saver: { rawBytes: number };
    };
    expect(parsed.parity.ok).toBe(true);
    expect(parsed.tokensRaw).toBeGreaterThan(0);
    // Swapped raw/saver assignment (or filtering the wrong pass) dies here.
    expect(parsed.raw.rawBytes).toBe(40_000);
    expect(parsed.saver.rawBytes).toBe(2);
  });

  it("saver returning more than raw → terminal prints the honest savingsNote", async () => {
    // Multi-line (a single 40k line costs seconds in the filter): the filtered
    // return (summary + excerpt) still exceeds the 2-byte raw capture.
    const { runner } = fakeRunner([
      { exitCode: 0, wallMs: 100, output: "ok" },
      { exitCode: 0, wallMs: 120, output: "some tool output line\n".repeat(2_000) },
    ]);
    const { input } = baseInput({ runPass: runner });
    const code = await runBench(input);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("note: saver returned more than raw");
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

  it("--json --md keeps stdout a single JSON document; wrote goes to stderr", async () => {
    const { input, writeFile } = baseInput({ json: true, md: "bench.md" });
    expect(await runBench(input)).toBe(0);

    const parsed = JSON.parse(out.join("\n")) as { parity: { ok: boolean } };
    expect(parsed.parity.ok).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(err.join("\n")).toContain("wrote");
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
