import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  removePostToolUseHook,
  removePreToolUseHook,
  uninstallClaudeCodeHook,
} from "../src/hook-settings.js";

let dir: string;
afterEach(() => {
  dir = "";
});

function tmpSettings(initial?: unknown): string {
  dir = mkdtempSync(join(tmpdir(), "ms-hooks-"));
  const p = join(dir, "settings.json");
  if (initial !== undefined) writeFileSync(p, `${JSON.stringify(initial, null, 2)}\n`);
  return p;
}

describe("hook-settings", () => {
  it("install adds both Pre+Post entries and is idempotent", () => {
    const p = tmpSettings();
    expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    const status = readClaudeCodeHookStatus({ settingsPath: p });
    expect(status).toEqual({ connected: true, preInstalled: true, postInstalled: true });
    expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(false);
  });

  it("uninstall removes only Mega Saver entries, preserving unrelated content", () => {
    const p = tmpSettings({
      model: "claude-opus",
      permissions: { allow: ["x"] },
      hooks: {
        PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "other pre" }] }],
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "other post" }] }],
      },
    });
    installClaudeCodeHook({ settingsPath: p });
    const res = uninstallClaudeCodeHook({ settingsPath: p });
    expect(res.changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.model).toBe("claude-opus");
    expect(after.permissions).toEqual({ allow: ["x"] });
    expect(after.hooks.PreToolUse).toEqual([
      { matcher: "Edit", hooks: [{ type: "command", command: "other pre" }] },
    ]);
    expect(after.hooks.PostToolUse).toEqual([
      { matcher: "Edit", hooks: [{ type: "command", command: "other post" }] },
    ]);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).connected).toBe(false);
  });

  it("uninstall strips only the Mega Saver command from a shared entry, keeping co-located user hooks", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "Read|Bash|Grep|Glob|LS",
            hooks: [
              { type: "command", command: "user-linter" },
              { type: "command", command: "mega hooks log" },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [
              { type: "command", command: "mega hooks saver" },
              { type: "command", command: "user-formatter" },
            ],
          },
        ],
      },
    });
    const res = uninstallClaudeCodeHook({ settingsPath: p });
    expect(res.changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.hooks.PreToolUse).toEqual([
      { matcher: "Read|Bash|Grep|Glob|LS", hooks: [{ type: "command", command: "user-linter" }] },
    ]);
    expect(after.hooks.PostToolUse).toEqual([
      { matcher: "Edit", hooks: [{ type: "command", command: "user-formatter" }] },
    ]);
  });

  it("uninstall on a file without the entries is a no-op", () => {
    const p = tmpSettings({ model: "x" });
    expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(false);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ model: "x" });
  });

  it("writes atomically, leaving no temp-file residue in the settings dir", () => {
    const p = tmpSettings({ model: "x" });
    installClaudeCodeHook({ settingsPath: p });
    uninstallClaudeCodeHook({ settingsPath: p });
    expect(readdirSync(dirname(p))).toEqual(["settings.json"]);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).connected).toBe(false);
  });

  it("install then uninstall round-trips to empty hooks", () => {
    const p = tmpSettings({});
    installClaudeCodeHook({ settingsPath: p });
    uninstallClaudeCodeHook({ settingsPath: p });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({});
  });

  it("status: missing file and malformed JSON read as all-false (no throw)", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "ms-hooks-")), "nope.json");
    expect(readClaudeCodeHookStatus({ settingsPath: missing })).toEqual({
      connected: false,
      preInstalled: false,
      postInstalled: false,
    });
    const bad = tmpSettings();
    writeFileSync(bad, "{ not json");
    expect(readClaudeCodeHookStatus({ settingsPath: bad }).connected).toBe(false);
  });

  it("status: partial install (only post) reports postInstalled, not connected", () => {
    const p = tmpSettings({});
    // simulate a manual partial state by removing the pre entry after install
    installClaudeCodeHook({ settingsPath: p });
    const s = JSON.parse(readFileSync(p, "utf8"));
    const cleaned = removePreToolUseHook(s, DEFAULT_HOOK_COMMAND);
    writeFileSync(p, `${JSON.stringify(cleaned, null, 2)}\n`);
    expect(readClaudeCodeHookStatus({ settingsPath: p })).toEqual({
      connected: false,
      preInstalled: false,
      postInstalled: true,
    });
    expect(SAVER_HOOK_COMMAND).toBe("mega hooks saver");
    expect(removePostToolUseHook).toBeTypeOf("function");
  });
});
