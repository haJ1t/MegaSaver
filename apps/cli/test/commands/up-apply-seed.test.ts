import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUp } from "../../src/commands/up.js";

let storeRoot: string;
let cwd: string;
let settingsPath: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-up-seed-store-"));
  cwd = mkdtempSync(join(tmpdir(), "mega-up-seed-cwd-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "mega-up-seed-cfg-"));
  settingsPath = join(cfgDir, "settings.json");
  writeFileSync(settingsPath, "{}\n");
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("runUp connector seeding", () => {
  it("actually creates CLAUDE.md on disk during mega up in a fresh workspace", async () => {
    const claudeMdPath = join(cwd, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(false);

    const stdout: string[] = [];
    const stderr: string[] = [];

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
      isTTY: false,
      json: false,
      deps: {
        apply: {
          hooksInstall: () => 0,
          ensureProject: async () => {
            const { runProjectCreate } = await import(
              "../../src/commands/project.js"
            );
            const createCode = await runProjectCreate({
              name: "test-project",
              rootFlag: cwd,
              storeFlag: storeRoot,
              cwd,
              home: cwd,
              xdgDataHome: undefined,
              platform: "darwin",
              localAppData: undefined,
              stdout: () => {},
              stderr: () => {},
            });
            return {
              code: createCode,
              name: "test-project",
              created: createCode === 0,
            };
          },
          connectorSync: async (projectName, targetId) => {
            const { runConnectorSync } = await import(
              "../../src/commands/connector/sync.js"
            );
            const errs: string[] = [];
            const outs: string[] = [];
            const res = await runConnectorSync({
              projectName,
              targetFlag: targetId,
              storeFlag: storeRoot,
              cwd,
              home: cwd,
              xdgDataHome: undefined,
              platform: "darwin",
              localAppData: undefined,
              json: false,
              stdout: (l) => outs.push(l),
              stderr: (l) => errs.push(l),
            });
            return res;
          },
          saverEnable: async () => 0,
          now: () => "2026-08-18T12:00:00.000Z",
        },
        verify: {
          spawn: () => ({ status: 0 }),
          now: () => Date.now(),
        },
        prompt: async () => true,
        gui: async () => {},
      },
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });

    expect(code).toBe(0);
    expect(existsSync(claudeMdPath)).toBe(true);
    const content = readFileSync(claudeMdPath, "utf8");
    expect(content).toContain("MEGA SAVER");
  });
});
