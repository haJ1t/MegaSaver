import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HOOK_COMMAND,
  HOOK_MATCHER,
  INTENT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  addPostToolUseHook,
  addUserPromptSubmitHook,
  hasUserPromptSubmitHook,
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
  it("HOOK_MATCHER and SAVER_HOOK_MATCHER cover the wave-1 tool surface (drift pin)", () => {
    expect(HOOK_MATCHER).toBe(
      "^(?:Read|Bash|Grep|Glob|LS|WebFetch|Task|BashOutput|Monitor|WebSearch|ToolSearch|mcp__.*)$",
    );
    expect(SAVER_HOOK_MATCHER).toBe(HOOK_MATCHER);
  });

  it("matcher is anchored: matches exact eligible tools, not substrings", () => {
    const re = new RegExp(HOOK_MATCHER);
    expect(re.test("Read")).toBe(true);
    expect(re.test("Task")).toBe(true);
    expect(re.test("mcp__vendor__get_page")).toBe(true);
    expect(re.test("TaskCreate")).toBe(false);
    expect(re.test("ReadMcpResourceTool")).toBe(false);
    expect(re.test("Xmcp__y")).toBe(false);
  });

  it("repairs a stale saver matcher in place on the add path (wave-1 upgrade)", () => {
    const stale = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Read|Bash|Grep|Glob|LS|WebFetch",
            hooks: [{ type: "command", command: "mega hooks saver" }],
          },
          { matcher: "Write", hooks: [{ type: "command", command: "other-tool run" }] },
        ],
      },
    };
    const next = addPostToolUseHook(stale, "mega hooks saver");
    const post = (next.hooks as { PostToolUse: Array<{ matcher?: string; hooks: unknown }> })
      .PostToolUse;
    expect(post).toHaveLength(2);
    expect(post[0]?.matcher).toBe(SAVER_HOOK_MATCHER);
    expect(post[1]).toEqual(stale.hooks.PostToolUse[1]); // foreign entry untouched
  });

  it("install adds both Pre+Post entries and is idempotent", () => {
    const p = tmpSettings();
    expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    const status = readClaudeCodeHookStatus({ settingsPath: p });
    expect(status).toEqual({
      connected: true,
      preInstalled: true,
      postInstalled: true,
      intentInstalled: true,
    });
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
      intentInstalled: false,
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
      intentInstalled: true,
    });
    expect(SAVER_HOOK_COMMAND).toBe("mega hooks saver");
    expect(removePostToolUseHook).toBeTypeOf("function");
  });
});

describe("UserPromptSubmit intent hook", () => {
  it("adds a UserPromptSubmit hook idempotently", () => {
    const once = addUserPromptSubmitHook({}, INTENT_HOOK_COMMAND);
    expect(hasUserPromptSubmitHook(once, INTENT_HOOK_COMMAND)).toBe(true);
    const twice = addUserPromptSubmitHook(once, INTENT_HOOK_COMMAND);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("install writes the UserPromptSubmit intent hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasUserPromptSubmitHook(written, INTENT_HOOK_COMMAND)).toBe(true);
  });

  it("uninstall removes the UserPromptSubmit intent hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    uninstallClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasUserPromptSubmitHook(written, INTENT_HOOK_COMMAND)).toBe(false);
  });
});
