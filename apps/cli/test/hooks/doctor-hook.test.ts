import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkHookTelemetry } from "../../src/commands/doctor.js";
import { installClaudeCodeHook } from "../../src/commands/hooks/install.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-doctor-hook-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkHookTelemetry", () => {
  it("reports missing when neither settings hook nor log exists, with the install hint", () => {
    const check = checkHookTelemetry({
      settingsPath: join(dir, "settings.json"),
      hookLogPath: join(dir, "log.jsonl"),
    });
    expect(check.key).toBe("claude-code-hook-telemetry");
    expect(check.value).toBe("missing");
    expect(check.pass).toBe(false);
    expect(check.reason).toContain("mega hooks install claude-code");
  });

  it("reports installed when the settings file carries the PreToolUse entry", () => {
    const settingsPath = join(dir, "settings.json");
    installClaudeCodeHook({ settingsPath });
    const check = checkHookTelemetry({ settingsPath, hookLogPath: join(dir, "log.jsonl") });
    expect(check.value).toBe("installed");
    expect(check.pass).toBe(true);
  });

  it("reports installed when only the hook log exists (telemetry is flowing)", () => {
    const hookLogPath = join(dir, "log.jsonl");
    writeFileSync(hookLogPath, `{"tool":"Read","category":"eligible_read"}\n`);
    const check = checkHookTelemetry({ settingsPath: join(dir, "settings.json"), hookLogPath });
    expect(check.value).toBe("installed");
    expect(check.pass).toBe(true);
  });

  it("does not throw when the settings file is malformed", () => {
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, "{ not json");
    expect(() =>
      checkHookTelemetry({ settingsPath, hookLogPath: join(dir, "log.jsonl") }),
    ).not.toThrow();
    expect(checkHookTelemetry({ settingsPath, hookLogPath: join(dir, "log.jsonl") }).value).toBe(
      "missing",
    );
  });
});
