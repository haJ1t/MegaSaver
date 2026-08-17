import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HookCommandConfig,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { CLAUDE_CODE_TARGET } from "../src/known-targets.js";
import { runConnectorSync } from "../src/commands/connector/sync.js";
import { ensureStoreReady } from "../src/store.js";
import { detectUpState } from "../src/up/detect.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let storeRoot: string;
let cwd: string;
let settingsPath: string;
const config: HookCommandConfig = {};

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-detect-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-up-detect-cwd-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "mega-up-detect-cfg-"));
  settingsPath = join(cfgDir, "settings.json");
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectUpState", () => {
  it("detects clean uninstalled state correctly", async () => {
    const state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });

    expect(state.settingsPath).toBe(settingsPath);
    expect(state.hooks).toEqual({
      kind: "readable",
      changed: true,
      priorConnected: false,
    });
    expect(state.saver).toEqual({
      enabled: false,
      mode: "safe",
    });
    expect(state.targets).toHaveLength(1);
    expect(state.targets[0]).toEqual({
      id: "claude-code",
      relativePath: "CLAUDE.md",
      prior: "missing",
      inSync: false,
    });
  });

  it("detects installed hooks as changed=false and priorConnected=true", async () => {
    installClaudeCodeHook({ settingsPath, platform: "darwin" });

    const state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });

    expect(state.hooks).toEqual({
      kind: "readable",
      changed: false,
      priorConnected: true,
    });
  });

  it("detects unparseable settings.json as unreadable conflict", async () => {
    writeFileSync(settingsPath, "{ nope");

    const state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });

    expect(state.hooks.kind).toBe("unreadable");
  });

  it("detects target file prior states: missing, no-block, block with inSync true/false", async () => {
    // 1. missing
    let state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });
    expect(state.targets[0]?.prior).toBe("missing");
    expect(state.targets[0]?.inSync).toBe(false);

    // 2. no-block
    const claudeMdPath = join(cwd, "CLAUDE.md");
    writeFileSync(claudeMdPath, "# My Project Rules\nNo mega saver here.\n");
    state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });
    expect(state.targets[0]?.prior).toBe("no-block");
    expect(state.targets[0]?.inSync).toBe(false);

    // 3. block synced with registered project
    const { registry } = await ensureStoreReady(storeRoot);
    registry.createProject({
      id: "11111111-1111-4111-8111-111111111111",
      name: "demo",
      rootPath: cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await runConnectorSync({
      projectName: "demo",
      targets: [CLAUDE_CODE_TARGET],
      dryRun: false,
      exact: false,
      storeFlag: storeRoot,
      cwd,
      home: cwd,
      xdgDataHome: undefined,
      platform: "darwin",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
    });

    state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });
    expect(state.targets[0]?.prior).toBe("block");
    expect(state.targets[0]?.inSync).toBe(true);

    // 4. hand-mutated block inside sentinels -> inSync is false
    const content = readFileSync(claudeMdPath, "utf8");
    writeFileSync(claudeMdPath, content.replace("Mega Saver", "Mega Tampered"));
    state = await detectUpState({
      settingsPath,
      storeRoot,
      cwd,
      targets: [CLAUDE_CODE_TARGET],
      config,
      platform: "darwin",
    });
    expect(state.targets[0]?.prior).toBe("block");
    expect(state.targets[0]?.inSync).toBe(false);
  });
});
