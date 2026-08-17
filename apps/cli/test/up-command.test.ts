import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUp } from "../src/commands/up.js";

let storeRoot: string;
let cwd: string;
let settingsPath: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-cmd-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-up-cmd-cwd-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "mega-up-cmd-cfg-"));
  settingsPath = join(cfgDir, "settings.json");
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("runUp command", () => {
  it("stops and prints plan when planOnly is true", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const applyMock = vi.fn(async () => ({ code: 0 as const }));
    const verifyMock = vi.fn(() => ({
      saver: { kind: "observed" as const, detail: "ok" },
      passive: [],
      daemon: "none",
    }));

    const code = await runUp({
      mode: "balanced",
      yes: false,
      planOnly: true,
      exact: true,
      gui: false,
      targetIds: ["claude-code"],
      settingsPath,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      isTTY: true,
      json: false,
      deps: {
        apply: {
          hooksInstall: () => 0,
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync: async () => 0,
          saverEnable: async () => 0,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => 1000,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("hooks:     install");
    expect(stdout.join("\n")).toContain("connector: install");
    expect(stdout.join("\n")).toContain("saver:     install");
  });

  it("refuses to write without --yes in non-TTY", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runUp({
      mode: "balanced",
      yes: false,
      planOnly: false,
      exact: true,
      gui: false,
      targetIds: ["claude-code"],
      settingsPath,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      isTTY: false,
      json: false,
      deps: {
        apply: {
          hooksInstall: () => 0,
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync: async () => 0,
          saverEnable: async () => 0,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => 1000,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("--yes");
  });

  it("exits 0 with nothing written when TTY prompt is declined", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const hooksInstall = vi.fn(() => 0 as const);

    const code = await runUp({
      mode: "balanced",
      yes: false,
      planOnly: false,
      exact: true,
      gui: false,
      targetIds: ["claude-code"],
      settingsPath,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      isTTY: true,
      json: false,
      deps: {
        apply: {
          hooksInstall,
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync: async () => 0,
          saverEnable: async () => 0,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => 1000,
        },
        prompt: async () => false, // declined
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(0);
    expect(hooksInstall).not.toHaveBeenCalled();
  });

  it("executes apply and verify on --yes", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const hooksInstall = vi.fn(() => 0 as const);
    const connectorSync = vi.fn(async () => 0 as const);
    const saverEnable = vi.fn(async () => 0 as const);

    const code = await runUp({
      mode: "balanced",
      yes: true,
      planOnly: false,
      exact: true,
      gui: false,
      targetIds: ["claude-code"],
      settingsPath,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      isTTY: true,
      json: false,
      deps: {
        apply: {
          hooksInstall,
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync,
          saverEnable,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => 1000,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(0);
    expect(hooksInstall).toHaveBeenCalledOnce();
    expect(connectorSync).toHaveBeenCalledOnce();
    expect(saverEnable).toHaveBeenCalledOnce();
    expect(stdout.join("\n")).toContain("verify:");
  });

  it("fails immediately on conflict without writing", async () => {
    writeFileSync(settingsPath, "{ corrupt json");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const hooksInstall = vi.fn(() => 0 as const);

    const code = await runUp({
      mode: "balanced",
      yes: true,
      planOnly: false,
      exact: true,
      gui: false,
      targetIds: ["claude-code"],
      settingsPath,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      isTTY: true,
      json: false,
      deps: {
        apply: {
          hooksInstall,
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync: async () => 0,
          saverEnable: async () => 0,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => 1000,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(1);
    expect(hooksInstall).not.toHaveBeenCalled();
    expect(stdout.join("\n")).toContain("conflict");
  });
});
