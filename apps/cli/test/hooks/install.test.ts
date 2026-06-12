import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOOK_MATCHER,
  addPreToolUseHook,
  hasPreToolUseHook,
  installClaudeCodeHook,
} from "../../src/commands/hooks/install.js";

const COMMAND = "mega hooks log";

describe("addPreToolUseHook (pure, idempotent)", () => {
  it("adds a PreToolUse matcher to empty settings", () => {
    const next = addPreToolUseHook({}, COMMAND);
    expect(hasPreToolUseHook(next, COMMAND)).toBe(true);
    const entries = (next as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse;
    expect(entries).toHaveLength(1);
  });

  it("uses the five-tool matcher and the command hook", () => {
    const next = addPreToolUseHook({}, COMMAND) as {
      hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };
    const entry = next.hooks.PreToolUse[0];
    expect(entry?.matcher).toBe(HOOK_MATCHER);
    expect(entry?.hooks[0]).toEqual({ type: "command", command: COMMAND });
  });

  it("is idempotent — re-adding does not duplicate the entry", () => {
    const once = addPreToolUseHook({}, COMMAND);
    const twice = addPreToolUseHook(once, COMMAND);
    expect((twice as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it("preserves unrelated settings keys and other PreToolUse entries", () => {
    const existing = {
      model: "claude-opus-4-8",
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "other-tool" }] }],
        PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "post" }] }],
      },
      permissions: { allow: ["Bash"] },
    };
    const next = addPreToolUseHook(existing, COMMAND) as typeof existing;
    expect(next.model).toBe("claude-opus-4-8");
    expect(next.permissions).toEqual({ allow: ["Bash"] });
    expect(next.hooks.PostToolUse).toEqual(existing.hooks.PostToolUse);
    expect(next.hooks.PreToolUse).toHaveLength(2);
    expect(hasPreToolUseHook(next, COMMAND)).toBe(true);
  });
});

describe("installClaudeCodeHook (file)", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "megasaver-hook-install-"));
    settingsPath = join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the hook entry into a fresh settings file and reports changed", () => {
    const result = installClaudeCodeHook({ settingsPath, command: COMMAND });
    expect(result.changed).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(hasPreToolUseHook(written, COMMAND)).toBe(true);
  });

  it("is idempotent — second run does not change the file and reports no-op", () => {
    installClaudeCodeHook({ settingsPath, command: COMMAND });
    const first = readFileSync(settingsPath, "utf8");
    const result = installClaudeCodeHook({ settingsPath, command: COMMAND });
    expect(result.changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(first);
  });

  it("preserves existing unrelated keys when merging into an existing file", () => {
    writeFileSync(settingsPath, JSON.stringify({ model: "x", permissions: { allow: ["Read"] } }));
    installClaudeCodeHook({ settingsPath, command: COMMAND });
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(written.model).toBe("x");
    expect(written.permissions).toEqual({ allow: ["Read"] });
    expect(hasPreToolUseHook(written, COMMAND)).toBe(true);
  });
});
