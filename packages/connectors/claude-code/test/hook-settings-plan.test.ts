import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installClaudeCodeHook, planClaudeCodeHookInstall } from "../src/index.js";

const tempSettings = (content?: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "mega-up-")), "settings.json");
  if (content !== undefined) writeFileSync(path, content);
  return path;
};

describe("planClaudeCodeHookInstall", () => {
  it("reports changed=true for a missing file and writes nothing", () => {
    const settingsPath = tempSettings();
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(true);
    expect(() => readFileSync(settingsPath, "utf8")).toThrow();
  });

  it("reports changed=false after a real install (value-diff parity)", () => {
    const settingsPath = tempSettings();
    installClaudeCodeHook({ settingsPath, platform: "darwin" });
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(false);
  });

  it("reports changed=true on a drifted matcher without repairing the file", () => {
    const settingsPath = tempSettings();
    installClaudeCodeHook({ settingsPath, platform: "darwin" });
    const drifted = readFileSync(settingsPath, "utf8").replace("^(?:Read|", "^(?:");
    writeFileSync(settingsPath, drifted);
    expect(planClaudeCodeHookInstall({ settingsPath, platform: "darwin" }).changed).toBe(true);
    expect(readFileSync(settingsPath, "utf8")).toBe(drifted);
  });
});
