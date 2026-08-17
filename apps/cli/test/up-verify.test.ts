import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import {
  recordCompletionHeartbeat,
  recordInvocationHeartbeat,
} from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpVerify, type UpVerifyDeps } from "../src/up/verify.js";

let storeRoot: string;
let settingsPath: string;
const cwd = "/workspace/project";
const NOW = Date.parse("2026-08-06T10:00:00.000Z");

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-verify-store-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "mega-up-verify-cfg-"));
  settingsPath = join(cfgDir, "settings.json");
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("runUpVerify", () => {
  it("reports observed when saver probe advances heartbeat", () => {
    installClaudeCodeHook({ settingsPath, platform: "darwin" });

    let t = NOW;
    const wk = encodeWorkspaceKey(cwd);
    const deps: UpVerifyDeps = {
      spawn: vi.fn((_cmd, _stdin, _timeout) => {
        t += 1000;
        recordInvocationHeartbeat(storeRoot, wk, new Date(t).toISOString(), t);
        recordCompletionHeartbeat(storeRoot, wk, new Date(t + 10).toISOString(), t + 10);
        return { status: 0, stdout: "" };
      }),
      now: () => t,
    };

    const res = runUpVerify({
      settingsPath,
      storeRoot,
      cwd,
      deps,
    });

    expect(res.saver.kind).toBe("observed");
    expect(res.saver.detail).toContain("heartbeat advanced");
    expect(res.passive).toHaveLength(4);
    for (const p of res.passive) {
      expect(p).toContain("installed, not yet observed");
      expect(p).not.toContain("✓ working");
    }
  });

  it("reports failed when probe exits 0 but does not advance heartbeat", () => {
    installClaudeCodeHook({ settingsPath, platform: "darwin" });

    const deps: UpVerifyDeps = {
      spawn: vi.fn(() => ({ status: 0, stdout: "" })),
      now: () => NOW,
    };

    const res = runUpVerify({
      settingsPath,
      storeRoot,
      cwd,
      deps,
    });

    expect(res.saver.kind).toBe("failed");
    expect(res.saver.detail).toContain("no heartbeat");
  });

  it("reports not-probeable when no saver hook is registered", () => {
    writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));

    const deps: UpVerifyDeps = {
      spawn: vi.fn(() => ({ status: 0 })),
      now: () => NOW,
    };

    const res = runUpVerify({
      settingsPath,
      storeRoot,
      cwd,
      deps,
    });

    expect(res.saver.kind).toBe("not-probeable");
  });
});
