import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installClaudeCodeHook,
  resolveClaudeCodeSettingsPath,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
} from "@megasaver/connectors-shared";
import {
  nodeResolverDeps,
  recordCompletionHeartbeat,
  recordInvocationHeartbeat,
  resolveActivationScope,
  resolveWorkspaceTokenSaverSettings,
  writeActivation,
} from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDown } from "../src/commands/down.js";
import { runUp } from "../src/commands/up.js";
import { readUpManifest } from "../src/up/manifest.js";

let storeRoot: string;
let cwd: string;
let settingsPath: string;
const NOW = Date.parse("2026-08-06T10:00:00.000Z");

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-down-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-up-down-cwd-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "mega-up-down-cfg-"));
  settingsPath = join(cfgDir, "settings.json");
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("up and down round-trip", () => {
  it("preserves foreign settings, removes ours, deletes missing-created file, restores prior saver", async () => {
    // 1. Pre-seed settings with foreign env & foreign hook
    const foreign = {
      env: { ANTHROPIC_BASE_URL: "http://localhost:4141" },
      hooks: {
        PostToolUse: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "my-linter --fix" }],
          },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(foreign, null, 2));

    // 2. Pre-seed saver with enabled=true, mode=aggressive
    const scope = resolveActivationScope(cwd, true);
    writeActivation(storeRoot, scope, true, "aggressive");

    const wk = encodeWorkspaceKey(cwd);
    let t = NOW;

    // 3. Run mega up --yes --mode balanced
    const upOut: string[] = [];
    const upCode = await runUp({
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
          hooksInstall: () => {
            installClaudeCodeHook({ settingsPath, platform: "darwin" });
            return 0;
          },
          ensureProject: async () => ({ code: 0, name: "demo", created: true }),
          connectorSync: async () => {
            // creates CLAUDE.md
            writeFileSync(
              join(cwd, "CLAUDE.md"),
              `${MEGA_SAVER_BLOCK_START}\nManaged block\n${MEGA_SAVER_BLOCK_END}\n`,
            );
            return 0;
          },
          saverEnable: async () => {
            writeActivation(storeRoot, scope, true, "balanced");
            return 0;
          },
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => {
            t += 1000;
            recordInvocationHeartbeat(storeRoot, wk, new Date(t).toISOString(), t);
            recordCompletionHeartbeat(storeRoot, wk, new Date(t + 10).toISOString(), t + 10);
            return { status: 0 };
          },
          now: () => t,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => upOut.push(l),
      stderr: () => {},
    });

    expect(upCode).toBe(0);
    expect(existsSync(join(cwd, "CLAUDE.md"))).toBe(true);

    // Verify manifest recorded 3 steps
    const m = readUpManifest(storeRoot, wk);
    expect(m.kind).toBe("ok");

    // 4. Run mega down --yes
    const downOut: string[] = [];
    const downCode = await runDown({
      yes: true,
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
        hooksUninstall: () => uninstallClaudeCodeHook({ settingsPath, platform: "darwin" }),
        saverRestore: (enabled, mode, exact) => {
          writeActivation(storeRoot, resolveActivationScope(cwd, exact), enabled, mode);
        },
        prompt: async () => true,
        now: () => "2026-08-06T11:00:00.000Z",
      },
      stdout: (l) => downOut.push(l),
      stderr: () => {},
    });

    expect(downCode).toBe(0);

    // CLAUDE.md was created as prior: missing and stripped remainder is empty -> deleted!
    expect(existsSync(join(cwd, "CLAUDE.md"))).toBe(false);

    // Settings has foreign preserved
    const afterSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(afterSettings.env?.ANTHROPIC_BASE_URL).toBe("http://localhost:4141");
    expect(afterSettings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe("my-linter --fix");

    // Saver was restored to prior enabled: true, mode: aggressive
    const resolvedSaver = resolveWorkspaceTokenSaverSettings(storeRoot, cwd, nodeResolverDeps());
    expect(resolvedSaver.enabled).toBe(true);
    expect(resolvedSaver.mode).toBe("aggressive");

    // Manifest marked as reversed
    const mAfter = readUpManifest(storeRoot, wk);
    expect(mAfter.kind).toBe("ok");
    if (mAfter.kind === "ok") {
      expect(mAfter.manifest.reversedAt).toBe("2026-08-06T11:00:00.000Z");
    }
  });

  it("leaves pre-existing content in CLAUDE.md when prior was no-block", async () => {
    // Pre-seed CLAUDE.md with user content
    writeFileSync(join(cwd, "CLAUDE.md"), "# Custom Rules\nKeep this rule.\n");

    const wk = encodeWorkspaceKey(cwd);
    let t = NOW;

    await runUp({
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
          hooksInstall: () => {
            installClaudeCodeHook({ settingsPath, platform: "darwin" });
            return 0;
          },
          ensureProject: async () => ({ code: 0, name: "demo", created: false }),
          connectorSync: async () => {
            writeFileSync(
              join(cwd, "CLAUDE.md"),
              `# Custom Rules\nKeep this rule.\n\n${MEGA_SAVER_BLOCK_START}\nManaged block\n${MEGA_SAVER_BLOCK_END}\n`,
            );
            return 0;
          },
          saverEnable: async () => 0,
          now: () => "2026-08-06T10:00:00.000Z",
        },
        verify: {
          spawn: () => {
            t += 1000;
            recordInvocationHeartbeat(storeRoot, wk, new Date(t).toISOString(), t);
            recordCompletionHeartbeat(storeRoot, wk, new Date(t + 10).toISOString(), t + 10);
            return { status: 0 };
          },
          now: () => t,
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: () => {},
      stderr: () => {},
    });

    await runDown({
      yes: true,
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
        hooksUninstall: () => ({ settingsPath, changed: true }),
        saverRestore: () => {},
        prompt: async () => true,
        now: () => "2026-08-06T11:00:00.000Z",
      },
      stdout: () => {},
      stderr: () => {},
    });

    expect(existsSync(join(cwd, "CLAUDE.md"))).toBe(true);
    const content = readFileSync(join(cwd, "CLAUDE.md"), "utf8");
    expect(content).toContain("# Custom Rules\nKeep this rule.");
    expect(content).not.toContain("<!-- MEGA SAVER:BEGIN -->");
  });
});
