import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExactRecord } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXEC_LIVE_MAX_DELIVERED_CHARS,
  execLiveCommandFromPositionals,
  parseExecLiveNumericArgs,
  runOutputExecLive,
} from "../../src/commands/output/exec-live.js";

let store: string;
let cwd: string;
let canonicalCwd: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-execlive-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-execlive-cwd-"));
  // macOS tmpdir() spells /var/... while getcwd/realpath spell /private/var/...
  // — the settings record lives under the CANONICAL key; the code must
  // canonicalize the raw cwd before deriving the workspace key (regression).
  canonicalCwd = realpathSync(cwd);
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const RAW = "line one\nline two"; // no trailing newline — passthrough must not add one
const SID = "live-abc-1";

function enableWorkspace(): void {
  writeExactRecord(store, encodeWorkspaceKey(canonicalCwd), {
    enabled: true,
    mode: "balanced",
    scope: "exact",
  });
}

function baseInput(overrides: Partial<Parameters<typeof runOutputExecLive>[0]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    input: {
      liveSessionId: SID,
      command: "vitest",
      args: ["run"] as const,
      storeFlag: store,
      cwd,
      home: "/home/test",
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      originPid: "123",
      stdout: (t: string) => out.push(t),
      stderr: (l: string) => err.push(l),
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 0 },
      })),
      ...overrides,
    },
    out,
    err,
  };
}

describe("runOutputExecLive", () => {
  it("delivers raw byte-identical on a non-compressed decision", async () => {
    enableWorkspace();
    const record = vi.fn(async () => ({
      decision: "passthrough" as const,
      summary: "",
      returnedText: RAW,
      rawBytes: RAW.length,
      returnedBytes: RAW.length,
      bytesSaved: 0,
      savingRatio: 0,
      deltaBytes: 0,
    }));
    const { input, out } = baseInput({ record });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe(RAW); // exact bytes, no added newline
    expect(code).toBe(0);
  });

  it("delivers returnedText on compressed and sets the LD7/LD8 record fields", async () => {
    enableWorkspace();
    const record = vi.fn(async () => ({
      decision: "compressed" as const,
      summary: "s",
      returnedText: "COMPRESSED+FOOTER",
      rawBytes: RAW.length,
      returnedBytes: 17,
      bytesSaved: RAW.length - 17,
      savingRatio: 0.5,
      deltaBytes: RAW.length - 17,
    }));
    const { input, out } = baseInput({ record });
    await runOutputExecLive(input);
    expect(out.join("")).toBe("COMPRESSED+FOOTER");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        storeRawOutput: true,
        includeFooter: true,
        origin: "exec-rewrite",
        sourceKind: "command",
        label: "vitest run",
        mode: "balanced",
        workspaceKey: encodeWorkspaceKey(canonicalCwd),
        liveSessionId: SID,
        evidenceStoreRoot: store,
      }),
    );
  });

  it("LD16: a compressed delivery above the client truncation cap falls back to raw", async () => {
    enableWorkspace();
    const oversized = `X${"c".repeat(EXEC_LIVE_MAX_DELIVERED_CHARS + 1)}`;
    const record = vi.fn(async () => ({
      decision: "compressed" as const,
      summary: "s",
      returnedText: oversized,
      rawBytes: RAW.length,
      returnedBytes: oversized.length,
      bytesSaved: 0,
      savingRatio: 0,
      deltaBytes: 0,
    }));
    const { input, out } = baseInput({ record });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe(RAW); // raw, never truncated-compressed-without-pointer
    expect(code).toBe(0);
  });

  it("skips record and delivers raw when the workspace saver is disabled", async () => {
    const record = vi.fn();
    const { input, out } = baseInput({ record });
    const code = await runOutputExecLive(input);
    expect(record).not.toHaveBeenCalled();
    expect(out.join("")).toBe(RAW);
    expect(code).toBe(0);
  });

  it("LD6: a record throw degrades to raw with the child exit mirrored", async () => {
    enableWorkspace();
    const record = vi.fn(async () => {
      throw new Error("store exploded");
    });
    const { input, out } = baseInput({
      record,
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 3 },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe(RAW);
    expect(code).toBe(3);
  });

  it("mirrors a non-zero child exit with a stderr note", async () => {
    const { input, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: RAW, childExitCode: 2 },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(code).toBe(2);
    expect(err).toContain("note: command exited 2");
  });

  it("terminated: delivers the partial, notes it on stderr, exits 1", async () => {
    const { input, out, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: true as const,
        capture: { raw: "partial", childExitCode: null, terminated: "timeout" as const },
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out.join("")).toBe("partial");
    expect(err).toContain("error: command_failed: terminated: timeout");
    expect(code).toBe(1);
  });

  it("spawn failure: command_failed detail on stderr, exit 1, no stdout", async () => {
    const { input, out, err } = baseInput({
      runChildImpl: vi.fn(async () => ({
        ok: false as const,
        reason: "command_failed" as const,
        detail: "spawn vitest ENOENT",
      })),
    });
    const code = await runOutputExecLive(input);
    expect(out).toEqual([]);
    expect(err).toContain("error: command_failed: spawn vitest ENOENT");
    expect(code).toBe(1);
  });

  it("unsafe live session id degrades to raw without recording", async () => {
    enableWorkspace();
    const record = vi.fn();
    const { input, out } = baseInput({ record, liveSessionId: "../evil" });
    await runOutputExecLive(input);
    expect(record).not.toHaveBeenCalled();
    expect(out.join("")).toBe(RAW);
  });

  it("LD13: non-allowlisted positionals are refused — no spawn, exit 1", async () => {
    const runChildImpl = vi.fn();
    const { input, out, err } = baseInput({
      runChildImpl,
      command: "pnpm",
      args: ["test"],
    });
    const code = await runOutputExecLive(input);
    expect(runChildImpl).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(err).toContain("error: refused: command not allowlisted");
    expect(code).toBe(1);
  });

  it("LD13: an argv element with whitespace is refused even when the join classifies", async () => {
    const runChildImpl = vi.fn();
    const { input, out, err } = baseInput({
      runChildImpl,
      command: "grep",
      args: ["-rn TODO", "src"],
    });
    const code = await runOutputExecLive(input);
    expect(runChildImpl).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(err).toContain("error: refused: command not allowlisted");
    expect(code).toBe(1);
  });

  it("LD14: identical re-runs mint the same content-derived chunk-set id", async () => {
    enableWorkspace();
    const record = vi.fn(async (_input: { newId?: () => string }) => ({
      decision: "compressed" as const,
      summary: "s",
      returnedText: "X",
      rawBytes: RAW.length,
      returnedBytes: 1,
      bytesSaved: RAW.length - 1,
      savingRatio: 0.5,
      deltaBytes: 0,
    }));
    await runOutputExecLive(baseInput({ record }).input);
    await runOutputExecLive(baseInput({ record }).input);
    const first = record.mock.calls[0]?.[0];
    const second = record.mock.calls[1]?.[0];
    if (first === undefined || second === undefined) throw new Error("record not called");
    expect(typeof first.newId).toBe("function");
    expect(first.newId?.()).toBe(second.newId?.());
    expect(first.newId?.()).toMatch(/^cs-[0-9a-f]{32}$/);
  });

  it("LD15: runChildImpl receives the 100MB default maxBytes and 600s timeout", async () => {
    const runChildImpl = vi.fn(async () => ({
      ok: true as const,
      capture: { raw: RAW, childExitCode: 0 },
    }));
    await runOutputExecLive(baseInput({ runChildImpl }).input);
    expect(runChildImpl).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 100_000_000, timeoutMs: 600_000 }),
    );
  });
});

describe("execLiveCommandFromPositionals", () => {
  it("takes the first post-`--` token as the command", () => {
    expect(execLiveCommandFromPositionals(["vitest", "run", "--reporter", "dot"])).toEqual({
      command: "vitest",
      commandArgs: ["run", "--reporter", "dot"],
    });
  });
  it("yields an empty command for no tokens", () => {
    expect(execLiveCommandFromPositionals([])).toEqual({ command: "", commandArgs: [] });
  });
});

describe("parseExecLiveNumericArgs", () => {
  it("accepts positive finite values", () => {
    expect(parseExecLiveNumericArgs("30", "1000")).toEqual({ timeoutSec: 30, maxBytes: 1000 });
  });
  it("drops zero, negative, and non-numeric values to the defaults", () => {
    expect(parseExecLiveNumericArgs("0", "-5")).toEqual({});
    expect(parseExecLiveNumericArgs("abc", undefined)).toEqual({});
    expect(parseExecLiveNumericArgs(undefined, "")).toEqual({});
  });
});
