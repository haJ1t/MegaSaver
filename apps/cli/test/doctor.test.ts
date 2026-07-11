import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Check,
  checkCwd,
  checkHookTelemetry,
  checkNode,
  checkPlatform,
  doctorCommand,
  exitCodeFor,
  renderReport,
  runChecks,
} from "../src/commands/doctor.js";

describe("checkNode", () => {
  it("PASSes for Node 22.x", () => {
    expect(checkNode("22.11.0")).toEqual({
      key: "node",
      value: "v22.11.0",
      pass: true,
    });
  });

  it("PASSes for Node 23.x", () => {
    expect(checkNode("23.0.0")).toEqual({
      key: "node",
      value: "v23.0.0",
      pass: true,
    });
  });

  it("PASSes for the lower bound 22.0.0", () => {
    expect(checkNode("22.0.0")).toEqual({
      key: "node",
      value: "v22.0.0",
      pass: true,
    });
  });

  it("PASSes for a 22.x pre-release", () => {
    expect(checkNode("22.0.0-rc.1")).toEqual({
      key: "node",
      value: "v22.0.0-rc.1",
      pass: true,
    });
  });

  it("FAILs for Node 20.x with reason", () => {
    expect(checkNode("20.10.0")).toEqual({
      key: "node",
      value: "v20.10.0",
      pass: false,
      reason: "need ≥22",
    });
  });

  it("FAILs for Node 18.x", () => {
    expect(checkNode("18.20.0")).toEqual({
      key: "node",
      value: "v18.20.0",
      pass: false,
      reason: "need ≥22",
    });
  });
});

describe("checkPlatform", () => {
  it("PASSes and returns the platform string", () => {
    expect(checkPlatform("darwin")).toEqual({
      key: "platform",
      value: "darwin",
      pass: true,
    });
  });

  it("PASSes for linux", () => {
    expect(checkPlatform("linux")).toEqual({
      key: "platform",
      value: "linux",
      pass: true,
    });
  });
});

describe("checkCwd", () => {
  it("PASSes and returns the cwd string", () => {
    expect(checkCwd("/foo/bar")).toEqual({
      key: "cwd",
      value: "/foo/bar",
      pass: true,
    });
  });
});

describe("runChecks", () => {
  it("returns three checks in fixed order on the current process", () => {
    const checks = runChecks();
    expect(checks).toHaveLength(3);
    expect(checks[0]?.key).toBe("node");
    expect(checks[1]?.key).toBe("platform");
    expect(checks[2]?.key).toBe("cwd");
  });
});

describe("renderReport", () => {
  it("formats an all-PASS report with summary", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v22.11.0 PASS\nplatform darwin PASS\ncwd /foo PASS\n\n3 PASS / 0 FAIL",
    );
  });

  it("includes the parenthesized reason for FAIL rows", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v20.10.0 FAIL (need ≥22)\nplatform darwin PASS\ncwd /foo PASS\n\n2 PASS / 1 FAIL",
    );
  });
});

describe("exitCodeFor", () => {
  it("returns 0 when all checks PASS", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(0);
  });

  it("returns 1 when any check FAILs", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(1);
  });
});

describe("doctorCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let tempHome: string;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 0;
    // SAFETY: point HOME/USERPROFILE at an empty temp dir so the hook-telemetry
    // check never stats or reads the developer's real ~/.claude during tests.
    tempHome = mkdtempSync(join(tmpdir(), "megasaver-doctor-home-"));
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("USERPROFILE", tempHome);
    vi.stubEnv("XDG_DATA_HOME", join(tempHome, "xdg"));
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = 0;
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("calls console.log exactly once", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("prints a report that ends with the summary line", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toMatch(/^node v\d+\.\d+\.\d+/);
    expect(output).toContain("saver-hooks-registered");
    expect(output).toMatch(/7 PASS \/ 0 FAIL/);
  });

  it("sets exitCode 0 when the saver hook is not installed (absent = WARN, not FAIL)", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    expect(process.exitCode).toBe(0);
  });

  it("reports hook telemetry as missing with the install hint when absent", () => {
    // Inject temp paths so the check is deterministic regardless of the dev's
    // real ~/.claude. The HOME stub above is ineffective here: run()'s default
    // paths resolve via os.homedir() (which ignores the HOME env), so a machine
    // with the hook installed would otherwise report "installed". Test the
    // injectable unit directly — exactly what the doctor's design intends.
    const dir = mkdtempSync(join(tmpdir(), "megasaver-doctor-tele-"));
    try {
      const check = checkHookTelemetry({
        settingsPath: join(dir, "settings.json"), // absent
        hookLogPath: join(dir, "hooks.jsonl"), // absent
      });
      expect(check.value).toBe("missing");
      expect(check.pass).toBe(false);
      expect(check.reason).toContain("mega hooks install claude-code");
      // Telemetry is informational — it is excluded from the doctor's exit code.
      expect(exitCodeFor(runChecks())).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
