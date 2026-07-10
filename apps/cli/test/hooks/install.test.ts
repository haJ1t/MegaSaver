import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOOK_MATCHER,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  addPostToolUseHook,
  addPreToolUseHook,
  hasPostToolUseHook,
  hasPreToolUseHook,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveBakedStoreRoot,
  resolveInvokedCliPath,
  runHooksInstall,
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
    expect(entry?.hooks[0]).toEqual({ type: "command", command: COMMAND, timeout: 10 });
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

describe("addPostToolUseHook (pure, idempotent)", () => {
  it("adds a PostToolUse matcher to empty settings", () => {
    const next = addPostToolUseHook({}, SAVER_HOOK_COMMAND) as {
      hooks: { PostToolUse: { matcher: string; hooks: { type: string; command: string }[] }[] };
    };
    const entry = next.hooks.PostToolUse[0];
    expect(entry?.matcher).toBe(SAVER_HOOK_MATCHER);
    expect(entry?.hooks[0]).toEqual({ type: "command", command: SAVER_HOOK_COMMAND, timeout: 30 });
    expect(hasPostToolUseHook(next, SAVER_HOOK_COMMAND)).toBe(true);
  });

  it("is idempotent — re-adding does not duplicate the entry", () => {
    const once = addPostToolUseHook({}, SAVER_HOOK_COMMAND);
    const twice = addPostToolUseHook(once, SAVER_HOOK_COMMAND);
    expect((twice as { hooks: { PostToolUse: unknown[] } }).hooks.PostToolUse).toHaveLength(1);
    expect(hasPostToolUseHook(twice, SAVER_HOOK_COMMAND)).toBe(true);
    expect(twice).toEqual(once);
  });

  it("preserves an existing unrelated PostToolUse entry", () => {
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: "X", hooks: [{ type: "command", command: "other" }] }],
      },
    };
    const next = addPostToolUseHook(existing, SAVER_HOOK_COMMAND) as typeof existing;
    expect(next.hooks.PostToolUse).toHaveLength(2);
    expect(next.hooks.PostToolUse[0]).toEqual(existing.hooks.PostToolUse[0]);
    // has* now matches by the "hooks <subcommand>" suffix, so a foreign command
    // is not reported present; assert preservation structurally instead.
    expect(next.hooks.PostToolUse.some((e) => e.hooks.some((h) => h.command === "other"))).toBe(
      true,
    );
    expect(hasPostToolUseHook(next, SAVER_HOOK_COMMAND)).toBe(true);
  });

  it("preserves a sibling PreToolUse array and unrelated top-level keys", () => {
    const existing = {
      model: "x",
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "other-tool" }] }],
      },
    };
    const next = addPostToolUseHook(existing, SAVER_HOOK_COMMAND) as typeof existing & {
      hooks: { PostToolUse: unknown[] };
    };
    expect(next.model).toBe("x");
    expect(next.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(next.hooks.PostToolUse).toHaveLength(1);
    expect(hasPostToolUseHook(next, SAVER_HOOK_COMMAND)).toBe(true);
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

  it("installs BOTH the PreToolUse log hook and the PostToolUse saver hook", () => {
    installClaudeCodeHook({ settingsPath });
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    const pre = (s.hooks.PreToolUse as Array<{ hooks: { command: string }[] }>).flatMap(
      (e) => e.hooks,
    );
    const post = (s.hooks.PostToolUse as Array<{ hooks: { command: string }[] }>).flatMap(
      (e) => e.hooks,
    );
    expect(pre.some((h) => h.command === "mega hooks log")).toBe(true);
    expect(post.some((h) => h.command === "mega hooks saver")).toBe(true);
  });

  it("is idempotent across both hooks (re-install is a no-op)", () => {
    installClaudeCodeHook({ settingsPath });
    const first = readFileSync(settingsPath, "utf8");
    const result = installClaudeCodeHook({ settingsPath });
    expect(result.changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(first);
  });

  it("repairs a stale matcher in place and reports changed (wave-1 upgrade)", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Read|Bash|Grep|Glob|LS", hooks: [{ type: "command", command: COMMAND }] },
          ],
          PostToolUse: [
            {
              matcher: "Read|Bash|Grep|Glob|LS|WebFetch",
              hooks: [{ type: "command", command: SAVER_HOOK_COMMAND }],
            },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "mega hooks intent" }] }],
        },
      }),
    );
    const result = installClaudeCodeHook({ settingsPath, command: COMMAND });
    expect(result.changed).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(written.hooks.PreToolUse[0].matcher).toBe(HOOK_MATCHER);
    expect(written.hooks.PostToolUse[0].matcher).toBe(SAVER_HOOK_MATCHER);
  });
});

describe("E29 store baking", () => {
  const env = {
    cwd: "/work",
    home: "/home/u",
    xdgDataHome: undefined,
    platform: "linux" as NodeJS.Platform,
    localAppData: undefined,
  };

  it("a non-default store resolves to a baked root", () => {
    expect(resolveBakedStoreRoot({ ...env, storeFlag: "/custom/store" })).toBe("/custom/store");
  });

  it("the default store bakes nothing", () => {
    expect(resolveBakedStoreRoot({ ...env, storeFlag: undefined })).toBeUndefined();
  });

  it("runHooksInstall writes the config-built commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-install-bake-"));
    try {
      const p = join(dir, "settings.json");
      const code = runHooksInstall({
        target: "claude-code",
        settingsPath: p,
        config: { cliPath: "/opt/homebrew/bin/mega", storeRoot: "/custom/store" },
        stdout: () => {},
        stderr: () => {},
        json: false,
      });
      expect(code).toBe(0);
      const s = JSON.parse(readFileSync(p, "utf8"));
      expect(s.hooks.PostToolUse[0].hooks[0].command).toBe(
        '/opt/homebrew/bin/mega --store "/custom/store" hooks saver',
      );
      expect(s.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveInvokedCliPath", () => {
  it("returns an absolute argv[1] as-is", () => {
    expect(resolveInvokedCliPath("/usr/local/bin/mega")).toBe("/usr/local/bin/mega");
  });

  it("returns undefined when argv[1] is missing or unresolvable", () => {
    expect(resolveInvokedCliPath(undefined)).toBeUndefined();
    expect(resolveInvokedCliPath("definitely-not-a-real-file-xyz")).toBeUndefined();
  });
});
