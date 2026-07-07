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
