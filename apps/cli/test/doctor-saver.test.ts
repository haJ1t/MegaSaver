import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFailureHeartbeat, recordInvocationHeartbeat } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSaverChecks } from "../src/commands/doctor-saver.js";
import type { Check } from "../src/commands/doctor.js";

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

let dir: string;
let storeRoot: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-doctor-saver-"));
  storeRoot = join(dir, "store");
  mkdirSync(storeRoot, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeHookSettings(saverCommand: string): string {
  const p = join(dir, "settings.json");
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "^(?:Bash)$",
            hooks: [
              {
                type: "command",
                command: saverCommand.replace("hooks saver", "hooks log"),
                timeout: 10,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "^(?:Bash)$",
            hooks: [{ type: "command", command: saverCommand, timeout: 30 }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: saverCommand.replace("hooks saver", "hooks intent"),
                timeout: 10,
              },
            ],
          },
        ],
      },
    }),
  );
  return p;
}

function fakeBinary(): string {
  const bin = join(dir, "mega");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  return bin;
}

// A stub "hook" that behaves like the real saver: it bumps the invocation
// heartbeat, then exits 0. cmd-aware so the E22.2 `--version` probe (which
// also goes through the spawn dep) does not advance the heartbeat before the
// self-test takes its `before` snapshot. Nothing is ever really spawned.
const advancingSpawn = (cmd: string) => {
  if (!cmd.endsWith("--version")) {
    recordInvocationHeartbeat(storeRoot, "wk-selftest", iso(NOW + 1000), NOW + 1000);
  }
  return { status: 0 };
};

const find = (checks: Check[], key: string) => checks.find((c) => c.key === key);

describe("runSaverChecks", () => {
  it("passes end-to-end with registered absolute hooks + an advancing heartbeat", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    recordInvocationHeartbeat(storeRoot, "wk-a", iso(NOW - 1000), NOW - 1000);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn: advancingSpawn,
      now: () => NOW + 2000,
    });
    expect(find(checks, "saver-hooks-registered")?.pass).toBe(true);
    expect(find(checks, "saver-hook-binary")?.pass).toBe(true);
    expect(find(checks, "saver-self-test")?.pass).toBe(true);
    expect(find(checks, "saver-daemon")?.pass).toBe(true);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("FAILs the self-test on a non-zero exit with the repair hint", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn: () => ({ status: 127 }),
      now: () => NOW,
    });
    const selfTest = find(checks, "saver-self-test");
    expect(selfTest?.pass).toBe(false);
    expect(selfTest?.reason).toBe("run: mega hooks install");
  });

  it("FAILs registration when the saver hook is missing (and skips the dependent checks)", () => {
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ hooks: {} }));
    const checks = runSaverChecks({
      settingsPath: p,
      storeRoot,
      spawn: () => ({ status: 0 }),
      now: () => NOW,
    });
    const reg = find(checks, "saver-hooks-registered");
    expect(reg?.pass).toBe(false);
    expect(reg?.reason).toBe("run: mega hooks install");
    expect(find(checks, "saver-hook-binary")).toBeUndefined();
    expect(find(checks, "saver-self-test")).toBeUndefined();
  });

  it("WARNs (pass) when the hook never fired", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn: advancingSpawn,
      now: () => NOW,
    });
    const liveness = find(checks, "saver-liveness");
    expect(liveness?.pass).toBe(true);
    expect(liveness?.reason).toContain("warn");
  });

  it("FAILs liveness when failures exist without a newer completion", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    recordInvocationHeartbeat(storeRoot, "wk-a", iso(NOW - 500), NOW - 500);
    recordFailureHeartbeat(storeRoot, "wk-a", "record", iso(NOW - 100), NOW - 100);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn: advancingSpawn,
      now: () => NOW,
    });
    expect(find(checks, "saver-liveness")?.pass).toBe(false);
  });

  it("WARNs on a store baked into the command that differs from the CLI store (E29)", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} --store "/other/store" hooks saver`);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn: advancingSpawn,
      now: () => NOW,
    });
    const bake = find(checks, "saver-hook-store");
    expect(bake?.pass).toBe(true);
    expect(bake?.reason).toContain("split-brain");
  });

  it("WARNs when the registered binary reports a different --version (E22.2)", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const spawn = (cmd: string) =>
      cmd.endsWith("--version") ? { status: 0, stdout: "9.9.9\n" } : advancingSpawn(cmd);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn,
      now: () => NOW,
      cliVersion: "1.13.0",
    });
    const version = find(checks, "saver-hook-version");
    expect(version?.pass).toBe(true); // WARN, never FAIL
    expect(version?.value).toContain("9.9.9");
    expect(version?.value).toContain("1.13.0");
    expect(version?.reason).toContain("warn");
  });

  it("emits a clean version check (no warn) when versions match", () => {
    const bin = fakeBinary();
    const settingsPath = writeHookSettings(`${bin} hooks saver`);
    const spawn = (cmd: string) =>
      cmd.endsWith("--version") ? { status: 0, stdout: "1.13.0\n" } : advancingSpawn(cmd);
    const checks = runSaverChecks({
      settingsPath,
      storeRoot,
      spawn,
      now: () => NOW,
      cliVersion: "1.13.0",
    });
    const version = find(checks, "saver-hook-version");
    expect(version?.pass).toBe(true);
    expect(version?.reason).toBeUndefined();
  });
});
