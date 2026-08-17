import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UpApplyDeps, runUpApply } from "../src/up/apply.js";
import type { UpDetectedState } from "../src/up/detect.js";
import { readUpManifest } from "../src/up/manifest.js";
import { buildUpPlan } from "../src/up/plan.js";

let storeRoot: string;
const workspaceKey = "wk-apply-test";
const cwd = "/workspace/project";

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-apply-store-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("runUpApply", () => {
  const baseState: UpDetectedState = {
    settingsPath: "/home/user/.claude/settings.json",
    hooks: {
      kind: "readable",
      changed: true,
      priorConnected: false,
    },
    saver: {
      enabled: false,
      mode: "safe",
    },
    targets: [
      {
        id: "claude-code",
        relativePath: "CLAUDE.md",
        prior: "missing",
        inSync: false,
      },
    ],
  };

  it("executes install steps in order and writes manifest with priors", async () => {
    const plan = buildUpPlan(baseState, "balanced");
    const calls: string[] = [];

    const deps: UpApplyDeps = {
      hooksInstall: vi.fn<() => 0 | 1>(() => {
        calls.push("hooksInstall");
        return 0;
      }),
      ensureProject: vi.fn<() => Promise<{ code: 0 | 1; name: string; created: boolean }>>(
        async () => {
          calls.push("ensureProject");
          return { code: 0, name: "demo", created: true };
        },
      ),
      connectorSync: vi.fn<(name: string) => Promise<0 | 1>>(async (_name) => {
        calls.push("connectorSync");
        return 0;
      }),
      saverEnable: vi.fn<() => Promise<0 | 1>>(async () => {
        calls.push("saverEnable");
        return 0;
      }),
      now: () => "2026-08-06T10:00:00.000Z",
    };

    const res = await runUpApply({
      plan,
      state: baseState,
      storeRoot,
      workspaceKey,
      cwd,
      mode: "balanced",
      exact: true,
      deps,
    });

    expect(res.code).toBe(0);
    expect(calls).toEqual(["hooksInstall", "ensureProject", "connectorSync", "saverEnable"]);

    const manifestRead = readUpManifest(storeRoot, workspaceKey);
    expect(manifestRead.kind).toBe("ok");
    if (manifestRead.kind === "ok") {
      expect(manifestRead.manifest.steps).toHaveLength(3);
      expect(manifestRead.manifest.steps[0]?.kind).toBe("hooks-install");
      expect(manifestRead.manifest.steps[1]?.kind).toBe("connector-sync");
      expect(manifestRead.manifest.steps[2]?.kind).toBe("saver-enable");
    }
  });

  it("stops on first failure and keeps completed steps in manifest", async () => {
    const plan = buildUpPlan(baseState, "balanced");

    const deps: UpApplyDeps = {
      hooksInstall: vi.fn<() => 0 | 1>(() => 0),
      ensureProject: vi.fn<() => Promise<{ code: 0 | 1; name: string; created: boolean }>>(
        async () => ({
          code: 0,
          name: "demo",
          created: true,
        }),
      ),
      connectorSync: vi.fn<(name: string) => Promise<0 | 1>>(async (_name) => 0),
      saverEnable: vi.fn<() => Promise<0 | 1>>(async () => 1), // fail saverEnable
      now: () => "2026-08-06T10:00:00.000Z",
    };

    const res = await runUpApply({
      plan,
      state: baseState,
      storeRoot,
      workspaceKey,
      cwd,
      mode: "balanced",
      exact: true,
      deps,
    });

    expect(res.code).toBe(1);
    expect(res.failedStep).toBe("saver-enable");

    const manifestRead = readUpManifest(storeRoot, workspaceKey);
    expect(manifestRead.kind).toBe("ok");
    if (manifestRead.kind === "ok") {
      expect(manifestRead.manifest.steps).toHaveLength(2);
      expect(manifestRead.manifest.steps.map((s) => s.kind)).toEqual([
        "hooks-install",
        "connector-sync",
      ]);
    }
  });

  it("skips ok steps and performs zero dep calls when all ok", async () => {
    const okState: UpDetectedState = {
      ...baseState,
      hooks: { kind: "readable", changed: false, priorConnected: true },
      saver: { enabled: true, mode: "balanced" },
      targets: [{ id: "claude-code", relativePath: "CLAUDE.md", prior: "block", inSync: true }],
    };
    const plan = buildUpPlan(okState, "balanced");

    const deps: UpApplyDeps = {
      hooksInstall: vi.fn<() => 0 | 1>(() => 0),
      ensureProject: vi.fn<() => Promise<{ code: 0 | 1; name: string; created: boolean }>>(
        async () => ({
          code: 0,
          name: "demo",
          created: false,
        }),
      ),
      connectorSync: vi.fn<(name: string) => Promise<0 | 1>>(async (_name) => 0),
      saverEnable: vi.fn<() => Promise<0 | 1>>(async () => 0),
      now: () => "2026-08-06T10:00:00.000Z",
    };

    const res = await runUpApply({
      plan,
      state: okState,
      storeRoot,
      workspaceKey,
      cwd,
      mode: "balanced",
      exact: true,
      deps,
    });

    expect(res.code).toBe(0);
    expect(deps.hooksInstall).not.toHaveBeenCalled();
    expect(deps.ensureProject).not.toHaveBeenCalled();
    expect(deps.connectorSync).not.toHaveBeenCalled();
    expect(deps.saverEnable).not.toHaveBeenCalled();
  });
});
