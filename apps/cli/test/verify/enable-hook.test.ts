import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVerifyHookToggle } from "../../src/commands/verify/enable-hook.js";

const CMD = "mega hooks verify-reminder";

let dir: string;
const out: string[] = [];
const err: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-verify-hook-toggle-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function toggle(action: "enable" | "disable"): 0 | 1 {
  return runVerifyHookToggle({
    action,
    settingsPath: join(dir, "settings.json"),
    command: CMD,
    json: false,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
}

describe("mega verify enable-hook / disable-hook", () => {
  it("enable writes a Stop entry with the reminder command and no matcher", () => {
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["enabled"]);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as {
      hooks: { Stop: { matcher?: string; hooks: { command: string }[] }[] };
    };
    const entry = settings.hooks.Stop[0];
    expect(entry?.hooks[0]?.command).toBe(CMD);
    expect(entry !== undefined && "matcher" in entry).toBe(false);
  });

  it("enable is idempotent; disable strips; disable again reports not installed", () => {
    toggle("enable");
    const before = readFileSync(join(dir, "settings.json"), "utf8");
    out.length = 0;
    expect(toggle("enable")).toBe(0);
    expect(out).toEqual(["already enabled"]);
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(before);

    out.length = 0;
    expect(toggle("disable")).toBe(0);
    expect(out).toEqual(["disabled"]);
    // Clean uninstall leaves no residue (pruneHooks round-trip precedent).
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
