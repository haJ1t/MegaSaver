import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordInvocationHeartbeat,
  writeExactRecord,
  writeGlobalDefault,
} from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionSaverResolve } from "../src/commands/session/saver/index.js";

const CWD = "/work/not-a-repo";

describe("session saver resolve", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "megasaver-cli-resolve-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  const run = async (json = false, now?: number) => {
    const out: string[] = [];
    const code = await runSessionSaverResolve({
      storeFlag: store,
      cwd: CWD,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json,
      ...(now !== undefined ? { now } : {}),
    });
    return { out, code };
  };

  it("reports disabled/missing for a fresh non-repo workspace", async () => {
    const { out, code } = await run(true);
    expect(code).toBe(0);
    const p = JSON.parse(out[0] as string);
    expect(p.enabled).toBe(false);
    expect(p.source).toBe("missing");
    expect(p.lastInvocationAt).toBeNull();
    expect(p.lastCompressionAt).toBeNull();
  });

  it("reflects a global-default enable and observed invocation heartbeat", async () => {
    const now = Date.UTC(2026, 0, 1);
    writeGlobalDefault(store, { enabled: true, mode: "safe" });
    recordInvocationHeartbeat(store, encodeWorkspaceKey(CWD), new Date(now).toISOString(), now);
    const { out } = await run(true, now);
    const p = JSON.parse(out[0] as string);
    expect(p.enabled).toBe(true);
    expect(p.source).toBe("global");
    expect(p.lastInvocationHereAt).toBe(new Date(now).toISOString());
    expect(p.lastInvocationAt).toBe(new Date(now).toISOString());
  });

  it("text mode shows source and liveness lines", async () => {
    const { out } = await run(false);
    const joined = out.join("\n").toLowerCase();
    expect(joined).toContain("saver mode");
    expect(joined).toContain("source missing");
    expect(joined).toContain("none observed");
  });

  it("D19: reports the policy clamp for a floored aggressive record", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "megasaver-resolve-floored-"));
    mkdirSync(join(cwd, ".megasaver"), { recursive: true });
    writeFileSync(join(cwd, ".megasaver", "policy.json"), JSON.stringify({ modeFloor: "balanced" }));
    writeExactRecord(store, encodeWorkspaceKey(cwd), {
      enabled: true,
      mode: "aggressive",
      scope: "exact",
    });
    const out: string[] = [];
    const code = await runSessionSaverResolve({
      storeFlag: store,
      cwd,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.mode).toBe("balanced");
    expect(parsed.policyClamp).toEqual({ floor: "balanced", original: "aggressive" });
    rmSync(cwd, { recursive: true, force: true });
  });
});
