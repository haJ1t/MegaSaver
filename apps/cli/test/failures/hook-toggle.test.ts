import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailuresHookToggle } from "../../src/commands/failures/hook-toggle.js";

const CMD = "mega hooks failure-scan";

let dir: string;
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-failures-hook-toggle-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function toggle(action: "enable" | "disable"): 0 | 1 {
  return runFailuresHookToggle({
    action,
    settingsPath: join(dir, "settings.json"),
    command: CMD,
    json: false,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
}

describe("mega alerts --failures --enable-hook / --disable-hook", () => {
  it("enable writes a Stop entry keyed by the failure-scan subcommand", () => {
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["enabled"]);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as {
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.Stop[0]?.hooks[0]?.command).toBe(CMD);
  });

  it("a second Stop entry coexists with the gate's verify-reminder entry (disjoint triggers)", () => {
    const settingsPath = join(dir, "settings.json");
    writeSettings(settingsPath, {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "mega hooks verify-reminder", timeout: 10 }] },
        ],
      },
    });
    expect(toggle("enable")).toBe(0);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0]?.hooks[0]?.command).toBe("mega hooks verify-reminder");
    expect(settings.hooks.Stop[1]?.hooks[0]?.command).toBe(CMD);
  });

  it("enable is idempotent; disable strips only the failure-scan entry", () => {
    toggle("enable");
    const before = readFileSync(join(dir, "settings.json"), "utf8");
    out.length = 0;
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["already enabled"]);
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(before);

    out.length = 0;
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["disabled"]);
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).toEqual({});

    out.length = 0;
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["not installed"]);
  });

  it("disable on a missing settings file reports not installed and creates nothing", () => {
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["not installed"]);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });
});

function writeSettings(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}
