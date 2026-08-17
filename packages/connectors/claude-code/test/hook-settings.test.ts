import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_ADVICE_HOOK_COMMAND,
  CACHE_ADVICE_HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  EXEC_REWRITE_HOOK_COMMAND,
  EXEC_REWRITE_HOOK_MATCHER,
  GUARD_HOOK_COMMAND,
  GUARD_HOOK_MATCHER,
  HOOK_MATCHER,
  INTENT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  WARMUP_HOOK_COMMAND,
  addCacheAdviceHook,
  addExecRewriteHook,
  addGuardHook,
  addPostToolUseHook,
  addPreToolUseHook,
  addSessionStartHook,
  addUserPromptSubmitHook,
  buildHookCommand,
  hasCacheAdviceHook,
  hasExecRewriteHook,
  hasGuardHook,
  hasSessionStartHook,
  hasUserPromptSubmitHook,
  hookCommandMatches,
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  removeCacheAdviceHook,
  removeExecRewriteHook,
  removePostToolUseHook,
  removePreToolUseHook,
  removeSessionStartHook,
  uninstallClaudeCodeHook,
} from "../src/hook-settings.js";

let dir: string;
afterEach(() => {
  dir = "";
});

const POSIX_PLATFORM = "linux" as NodeJS.Platform;

function withProcessPlatform<T>(platform: NodeJS.Platform, operation: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (descriptor === undefined) throw new Error("process.platform descriptor is unavailable");
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return operation();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

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
    expect(installClaudeCodeHook({ settingsPath: p, platform: POSIX_PLATFORM }).changed).toBe(true);
    const status = readClaudeCodeHookStatus({ settingsPath: p });
    expect(status).toEqual({
      connected: true,
      preInstalled: true,
      postInstalled: true,
      intentInstalled: true,
      warmupInstalled: true,
      capsuleInstalled: true,
      recapInstalled: true,
      guardInstalled: true,
      cacheAdviceInstalled: true,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });
    expect(installClaudeCodeHook({ settingsPath: p, platform: POSIX_PLATFORM }).changed).toBe(
      false,
    );
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
    installClaudeCodeHook({ settingsPath: p, platform: POSIX_PLATFORM });
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
      warmupInstalled: false,
      capsuleInstalled: false,
      recapInstalled: false,
      guardInstalled: false,
      cacheAdviceInstalled: false,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });
    const bad = tmpSettings();
    writeFileSync(bad, "{ not json");
    expect(readClaudeCodeHookStatus({ settingsPath: bad }).connected).toBe(false);
  });

  it("status: partial install (only post) reports postInstalled, not connected", () => {
    const p = tmpSettings({});
    // simulate a manual partial state by removing the pre entry after install
    installClaudeCodeHook({ settingsPath: p, platform: POSIX_PLATFORM });
    const s = JSON.parse(readFileSync(p, "utf8"));
    const cleaned = removePreToolUseHook(s, DEFAULT_HOOK_COMMAND);
    writeFileSync(p, `${JSON.stringify(cleaned, null, 2)}\n`);
    expect(readClaudeCodeHookStatus({ settingsPath: p })).toEqual({
      connected: false,
      preInstalled: false,
      postInstalled: true,
      intentInstalled: true,
      warmupInstalled: true,
      capsuleInstalled: true,
      recapInstalled: true,
      guardInstalled: true,
      cacheAdviceInstalled: true,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
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

describe("SessionStart warmup hook", () => {
  it("adds a matcher-less SessionStart entry with 10s timeout", () => {
    const next = addSessionStartHook({}, WARMUP_HOOK_COMMAND) as {
      hooks: {
        SessionStart: { matcher?: string; hooks: { command: string; timeout: number }[] }[];
      };
    };
    const entry = next.hooks.SessionStart[0];
    expect(entry?.matcher).toBeUndefined();
    expect(entry?.hooks[0]).toEqual({ type: "command", command: WARMUP_HOOK_COMMAND, timeout: 10 });
  });

  it("is idempotent", () => {
    const once = addSessionStartHook({}, WARMUP_HOOK_COMMAND);
    const twice = addSessionStartHook(once, WARMUP_HOOK_COMMAND);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("has/remove round-trip", () => {
    const added = addSessionStartHook({}, WARMUP_HOOK_COMMAND);
    expect(hasSessionStartHook(added, WARMUP_HOOK_COMMAND)).toBe(true);
    const removed = removeSessionStartHook(added, WARMUP_HOOK_COMMAND);
    expect(hasSessionStartHook(removed, WARMUP_HOOK_COMMAND)).toBe(false);
    expect((removed as { hooks?: unknown }).hooks).toBeUndefined();
  });

  it("install writes the SessionStart warmup hook and status reports it", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasSessionStartHook(written, WARMUP_HOOK_COMMAND)).toBe(true);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).warmupInstalled).toBe(true);
  });

  it("uninstall removes the SessionStart warmup hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    uninstallClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasSessionStartHook(written, WARMUP_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).warmupInstalled).toBe(false);
  });

  it("install with warmup: false skips the SessionStart hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p, warmup: false });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasSessionStartHook(written, WARMUP_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).warmupInstalled).toBe(false);
  });
});

describe("guard hook", () => {
  it("addGuardHook adds a second PreToolUse entry with the guard matcher", () => {
    const next = addGuardHook(addPreToolUseHook({}, "mega hooks log"), "mega hooks guard") as {
      hooks: { PreToolUse: { matcher?: string; hooks: { command: string }[] }[] };
    };
    expect(next.hooks.PreToolUse.length).toBe(2);
    expect(next.hooks.PreToolUse[1]?.matcher).toBe(GUARD_HOOK_MATCHER);
    expect(next.hooks.PreToolUse[1]?.hooks[0]?.command).toBe("mega hooks guard");
  });

  it("hasGuardHook does not confuse the log entry for the guard entry", () => {
    const withLog = addPreToolUseHook({}, "mega hooks log");
    expect(hasGuardHook(withLog, GUARD_HOOK_COMMAND)).toBe(false);
    expect(hasGuardHook(addGuardHook(withLog, GUARD_HOOK_COMMAND), GUARD_HOOK_COMMAND)).toBe(true);
  });

  it("install writes the guard PreToolUse hook and status reports it", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasGuardHook(written, GUARD_HOOK_COMMAND)).toBe(true);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).guardInstalled).toBe(true);
  });

  it("uninstall removes the guard PreToolUse hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p });
    uninstallClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasGuardHook(written, GUARD_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).guardInstalled).toBe(false);
  });

  it("install with guard: false skips the guard PreToolUse hook", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p, guard: false });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasGuardHook(written, GUARD_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).guardInstalled).toBe(false);
  });

  it("status reports guardInstalled without folding it into connected", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p, guard: false });
    const status = readClaudeCodeHookStatus({ settingsPath: p });
    expect(status.guardInstalled).toBe(false);
    expect(status.connected).toBe(true);
  });
});

describe("cache advice hook", () => {
  it("adds a distinct Read/Grep/Glob entry idempotently", () => {
    const withLog = addPreToolUseHook({}, DEFAULT_HOOK_COMMAND);
    const once = addCacheAdviceHook(withLog, CACHE_ADVICE_HOOK_COMMAND) as {
      hooks: { PreToolUse: { matcher?: string; hooks: { command: string }[] }[] };
    };
    expect(once.hooks.PreToolUse).toHaveLength(2);
    expect(once.hooks.PreToolUse[1]).toEqual({
      matcher: CACHE_ADVICE_HOOK_MATCHER,
      hooks: [{ type: "command", command: CACHE_ADVICE_HOOK_COMMAND, timeout: 10 }],
    });
    expect(hasCacheAdviceHook(once, CACHE_ADVICE_HOOK_COMMAND)).toBe(true);
    expect(addCacheAdviceHook(once, CACHE_ADVICE_HOOK_COMMAND)).toEqual(once);
  });

  it("removes only the advice command through the shared strip path", () => {
    const shared = {
      hooks: {
        PreToolUse: [
          {
            matcher: "keep-matcher",
            custom: "keep-metadata",
            hooks: [
              { type: "command" as const, command: CACHE_ADVICE_HOOK_COMMAND, timeout: 10 },
              { type: "command" as const, command: "user-helper", timeout: 17 },
            ],
          },
          {
            matcher: HOOK_MATCHER,
            hooks: [{ type: "command" as const, command: DEFAULT_HOOK_COMMAND, timeout: 10 }],
          },
        ],
      },
    };
    expect(removeCacheAdviceHook(shared, CACHE_ADVICE_HOOK_COMMAND)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "keep-matcher",
            custom: "keep-metadata",
            hooks: [{ type: "command", command: "user-helper", timeout: 17 }],
          },
          shared.hooks.PreToolUse[1],
        ],
      },
    });
  });

  it("builds the store-aware cache-advice command", () => {
    expect(
      buildHookCommand("cache-advice", {
        cliPath: "/opt/homebrew/bin/mega",
        storeRoot: "/data/mega",
      }),
    ).toBe("/opt/homebrew/bin/mega hooks cache-advice --store /data/mega");
  });

  it("reports advice installation separately from the connected core hooks", () => {
    const p = tmpSettings();
    installClaudeCodeHook({ settingsPath: p, cacheAdvice: false, platform: POSIX_PLATFORM });

    expect(readClaudeCodeHookStatus({ settingsPath: p })).toMatchObject({
      connected: true,
      cacheAdviceInstalled: false,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });

    installClaudeCodeHook({ settingsPath: p, cacheAdvice: true, platform: POSIX_PLATFORM });
    expect(readClaudeCodeHookStatus({ settingsPath: p })).toMatchObject({
      connected: true,
      cacheAdviceInstalled: true,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });
  });

  it("never installs advice on Windows and removes a legacy owned command", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "custom",
            metadata: "keep",
            hooks: [
              { type: "command", command: CACHE_ADVICE_HOOK_COMMAND, timeout: 10 },
              { type: "command", command: "foreign-helper", timeout: 17 },
            ],
          },
        ],
      },
    });

    installClaudeCodeHook({ settingsPath: p, cacheAdvice: true, platform: "win32" } as never);

    const settings = JSON.parse(readFileSync(p, "utf8"));
    expect(hasCacheAdviceHook(settings, CACHE_ADVICE_HOOK_COMMAND)).toBe(false);
    expect(settings.hooks.PreToolUse).toContainEqual({
      matcher: "custom",
      metadata: "keep",
      hooks: [{ type: "command", command: "foreign-helper", timeout: 17 }],
    });
    expect(readClaudeCodeHookStatus({ settingsPath: p })).toMatchObject({
      connected: true,
      cacheAdviceInstalled: false,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });
  });

  it("uses the inherited Windows platform to omit advice by default", () => {
    const p = tmpSettings();
    withProcessPlatform("win32", () => installClaudeCodeHook({ settingsPath: p }));

    expect(readClaudeCodeHookStatus({ settingsPath: p })).toMatchObject({
      connected: true,
      cacheAdviceInstalled: false,
      meshHintInstalled: false,
      execRewriteInstalled: false,
      stopInstalled: false,
    });
  });
});

describe("buildHookCommand (E23/E29)", () => {
  it("legacy bare form when no config", () => {
    expect(buildHookCommand("saver")).toBe("mega hooks saver");
    expect(buildHookCommand("log")).toBe(DEFAULT_HOOK_COMMAND);
    expect(buildHookCommand("intent")).toBe("mega hooks intent");
  });

  it("absolute cliPath, quoted only when it contains whitespace", () => {
    expect(buildHookCommand("saver", { cliPath: "/opt/homebrew/bin/mega" })).toBe(
      "/opt/homebrew/bin/mega hooks saver",
    );
    expect(buildHookCommand("saver", { cliPath: "/Users/a b/mega" })).toBe(
      "'/Users/a b/mega' hooks saver",
    );
  });

  it("places a baked --store after the hook subcommand so Citty parses it", () => {
    expect(
      buildHookCommand("saver", { cliPath: "/usr/local/bin/mega", storeRoot: "/data/mega" }),
    ).toBe("/usr/local/bin/mega hooks saver --store /data/mega");
    expect(buildHookCommand("warmup", { storeRoot: "/data/mega" })).toBe(
      "mega hooks warmup --store /data/mega",
    );
    expect(buildHookCommand("guard", { storeRoot: "/data/mega" })).toBe(
      "mega hooks guard --store /data/mega",
    );
    expect(buildHookCommand("log", { storeRoot: "/data/mega" })).toBe("mega hooks log");
  });

  it("preserves hostile store roots as one literal shell argument", () => {
    const settingsPath = tmpSettings();
    const launcher = join(dir, "mega");
    const capturedArgs = join(dir, "args");
    const injectedMarker = join(dir, "injected");
    const storeRoot = `/tmp/store $HOME \`not-run\` 'single' "double" $(touch ${injectedMarker})`;
    writeFileSync(launcher, '#!/bin/sh\nprintf "%s\\n" "$@" > "$MEGASAVER_CAPTURED_ARGS"\n', {
      mode: 0o700,
    });
    const command = buildHookCommand("intent", { cliPath: launcher, storeRoot });

    expect(hookCommandMatches(command, "intent")).toBe(true);
    execFileSync("sh", ["-c", command], {
      env: { ...process.env, MEGASAVER_CAPTURED_ARGS: capturedArgs },
    });
    expect(readFileSync(capturedArgs, "utf8").split("\n").filter(Boolean)).toEqual([
      "hooks",
      "intent",
      "--store",
      storeRoot,
    ]);
    expect(existsSync(injectedMarker)).toBe(false);

    expect(
      installClaudeCodeHook({ settingsPath, config: { cliPath: launcher, storeRoot } }).changed,
    ).toBe(true);
    expect(
      installClaudeCodeHook({ settingsPath, config: { cliPath: launcher, storeRoot } }).changed,
    ).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath }).intentInstalled).toBe(true);
    expect(uninstallClaudeCodeHook({ settingsPath }).changed).toBe(true);
  });

  it("does not take the hook subcommand from a quoted launcher path", () => {
    const p = tmpSettings();
    const config = { cliPath: "/tmp/with hooks saver/mega.mjs" };

    expect(installClaudeCodeHook({ settingsPath: p, config }).changed).toBe(true);
    expect(installClaudeCodeHook({ settingsPath: p, config }).changed).toBe(false);
    const settings = JSON.parse(readFileSync(p, "utf8"));
    expect(settings.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).connected).toBe(true);
    expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
  });
});

describe("hookCommandMatches", () => {
  it("matches bare, absolute, and store-baked forms", () => {
    expect(hookCommandMatches("mega hooks saver", "saver")).toBe(true);
    expect(hookCommandMatches("/opt/homebrew/bin/mega hooks saver", "saver")).toBe(true);
    expect(hookCommandMatches('"/Users/a b/mega" --store "/data" hooks saver', "saver")).toBe(true);
    expect(hookCommandMatches('/opt/homebrew/bin/mega hooks saver --store "/data"', "saver")).toBe(
      true,
    );
  });

  it("does not cross subcommands or match unrelated commands", () => {
    expect(hookCommandMatches("mega hooks saver", "log")).toBe(false);
    expect(hookCommandMatches("myhooks saver", "saver")).toBe(false);
    expect(hookCommandMatches("other-tool", "saver")).toBe(false);
    expect(hookCommandMatches("mega --store /a hooks intent --store /b", "intent")).toBe(false);
    expect(hookCommandMatches('mega hooks intent --store "$(touch${IFS}/tmp/pwn)"', "intent")).toBe(
      false,
    );
    expect(hookCommandMatches("mega hooks intent --store $(touch${IFS}/tmp/pwn)", "intent")).toBe(
      false,
    );
  });

  it("does not let an invalid dual-store command replace an owned saver hook", () => {
    const existing = {
      hooks: {
        PostToolUse: [
          { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: "mega hooks saver" }] },
        ],
      },
    };
    const invalid = "mega --store /a hooks saver --store /b";

    const next = addPostToolUseHook(existing, invalid);

    expect(next.hooks?.PostToolUse).toContainEqual(existing.hooks.PostToolUse[0]);
    expect(next.hooks?.PostToolUse).toContainEqual({
      matcher: HOOK_MATCHER,
      hooks: [{ type: "command", command: invalid, timeout: 10 }],
    });
  });

  it("treats Windows first-party launchers case-insensitively across lifecycle operations", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const intentCommand = '"C:\\Mega Saver\\MEGA.EXE" hooks intent';
    const p = tmpSettings({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: intentCommand }] }],
      },
    });
    try {
      expect(hookCommandMatches(intentCommand, "intent")).toBe(true);
      expect(
        hookCommandMatches(buildHookCommand("saver", { cliPath: "C:\\MEGA.CMD" }), "saver"),
      ).toBe(true);
      expect(
        hookCommandMatches(
          buildHookCommand("log", { cliPath: "C:\\Repo\\APPS\\CLI\\DIST\\CLI.JS" }),
          "log",
        ),
      ).toBe(true);
      expect(
        hookCommandMatches(
          buildHookCommand("intent", { cliPath: String.raw`\\server\share\MEGA.EXE` }),
          "intent",
        ),
      ).toBe(true);
      expect(
        hookCommandMatches(
          buildHookCommand("intent", { cliPath: String.raw`\\server\MEGA.EXE` }),
          "intent",
        ),
      ).toBe(false);
      expect(
        installClaudeCodeHook({ settingsPath: p, config: { cliPath: "C:\\next\\MEGA.EXE" } })
          .changed,
      ).toBe(true);
      expect(readClaudeCodeHookStatus({ settingsPath: p }).intentInstalled).toBe(true);
      expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    } finally {
      platform.mockRestore();
    }
  });

  it("repairs and removes a safe unquoted legacy Windows launcher", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const legacyIntent = String.raw`C:\MegaSaver\mega.exe hooks intent`;
    const legacySaver = String.raw`C:\MegaSaver\mega.cmd hooks saver`;
    const p = tmpSettings({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: legacyIntent }] }],
        PostToolUse: [
          { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: legacySaver }] },
        ],
      },
    });
    try {
      expect(hookCommandMatches(legacyIntent, "intent")).toBe(true);
      expect(hookCommandMatches(legacySaver, "saver")).toBe(true);
      expect(
        installClaudeCodeHook({ settingsPath: p, config: { cliPath: "C:\\next\\MEGA.EXE" } })
          .changed,
      ).toBe(true);
      expect(readClaudeCodeHookStatus({ settingsPath: p }).connected).toBe(true);
      expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
      expect(readFileSync(p, "utf8")).not.toContain(legacyIntent);
      expect(readFileSync(p, "utf8")).not.toContain(legacySaver);
    } finally {
      platform.mockRestore();
    }
  });

  it("keeps root-relative Windows launchers foreign across lifecycle operations", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const foreign = String.raw`\foreign\MEGA.EXE hooks intent`;
    const p = tmpSettings({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: foreign }] }] },
    });
    try {
      expect(hookCommandMatches(foreign, "intent")).toBe(false);
      expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
      expect(readClaudeCodeHookStatus({ settingsPath: p }).intentInstalled).toBe(true);
      expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
      const after = JSON.parse(readFileSync(p, "utf8"));
      expect(after.hooks.UserPromptSubmit).toContainEqual({
        hooks: [{ type: "command", command: foreign }],
      });
    } finally {
      platform.mockRestore();
    }
  });

  it("keeps a POSIX literal-backslash launcher foreign across lifecycle operations", () => {
    const foreign = '"/opt/foreign\\\\mega" hooks intent';
    const p = tmpSettings({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: foreign }] }] },
    });

    expect(hookCommandMatches(foreign, "intent")).toBe(false);
    expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).intentInstalled).toBe(true);
    expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.hooks.UserPromptSubmit).toContainEqual({
      hooks: [{ type: "command", command: foreign }],
    });
  });

  it("keeps POSIX .cmd and .exe launchers foreign across lifecycle operations", () => {
    const foreignIntent = "/opt/foreign/mega.exe hooks intent";
    const foreignSaver = "/opt/foreign/mega.cmd hooks saver";
    const p = tmpSettings({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: foreignIntent }] }],
        PostToolUse: [{ matcher: "Foreign", hooks: [{ type: "command", command: foreignSaver }] }],
      },
    });

    expect(hookCommandMatches(foreignIntent, "intent")).toBe(false);
    expect(hookCommandMatches(foreignSaver, "saver")).toBe(false);
    expect(installClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).connected).toBe(true);
    expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
    const after = JSON.parse(readFileSync(p, "utf8"));
    expect(after.hooks.UserPromptSubmit).toContainEqual({
      hooks: [{ type: "command", command: foreignIntent }],
    });
    expect(after.hooks.PostToolUse).toContainEqual({
      matcher: "Foreign",
      hooks: [{ type: "command", command: foreignSaver }],
    });
  });

  it("keeps POSIX launcher basename case-sensitive on Windows", () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      expect(hookCommandMatches("/opt/MEGA.EXE hooks intent", "intent")).toBe(false);
    } finally {
      platform.mockRestore();
    }
  });

  it("matches only supported absolute script and Windows launchers", () => {
    const supported = [
      "/opt/mega.mjs",
      "/opt/apps/cli/dist/cli.js",
      "/opt/@megasaver/cli/dist/cli.js",
      '"/opt/My App/mega.mjs"',
      '"/opt/My App/apps/cli/dist/cli.js"',
      '"/opt/My App/@megasaver/cli/dist/cli.js"',
    ];

    for (const launcher of supported) {
      expect(hookCommandMatches(`${launcher} hooks intent --store "/tmp/store"`, "intent")).toBe(
        true,
      );
    }
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      expect(
        hookCommandMatches(
          buildHookCommand("intent", { cliPath: String.raw`C:\MegaSaver\mega.cmd` }),
          "intent",
        ),
      ).toBe(true);
      expect(
        hookCommandMatches(
          buildHookCommand("intent", { cliPath: String.raw`C:\MegaSaver\mega.exe` }),
          "intent",
        ),
      ).toBe(true);
    } finally {
      platform.mockRestore();
    }
    expect(hookCommandMatches("/opt/foreign-runner hooks intent", "intent")).toBe(false);
    expect(hookCommandMatches("/opt/acme/cli.js hooks intent", "intent")).toBe(false);
    expect(hookCommandMatches("/opt/dist/cli.js hooks intent", "intent")).toBe(false);
    expect(hookCommandMatches("node /opt/mega.mjs hooks intent", "intent")).toBe(false);
  });

  it("rejects a deep quoted foreign launcher in bounded time", () => {
    const segments = Array.from({ length: 24 }, () => "segment").join("/");
    const command = `"/${segments}/foreign" hooks intent`;

    const startedAt = performance.now();
    expect(hookCommandMatches(command, "intent")).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});

describe("install migration (E23/E29)", () => {
  it("fresh install with config writes absolute commands + timeouts", () => {
    const p = tmpSettings();
    const r = installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/opt/homebrew/bin/mega" },
    });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks.PostToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks saver",
      timeout: 30,
    });
    expect(s.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks log",
      timeout: 10,
    });
    expect(s.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: "command",
      command: "/opt/homebrew/bin/mega hooks intent",
      timeout: 10,
    });
  });

  it("re-install over legacy bare entries migrates them in place (no duplicates)", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          { matcher: HOOK_MATCHER, hooks: [{ type: "command", command: "mega hooks log" }] },
        ],
        PostToolUse: [
          {
            matcher: SAVER_HOOK_MATCHER,
            hooks: [{ type: "command", command: "mega hooks saver" }],
          },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "mega hooks intent" }] }],
      },
    });
    const r = installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/opt/homebrew/bin/mega" },
      guard: false,
      platform: POSIX_PLATFORM,
    });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse[0].hooks[0].command).toBe("/opt/homebrew/bin/mega hooks saver");
    expect(s.hooks.PostToolUse[0].hooks[0].timeout).toBe(30);
    expect(s.hooks.PreToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[1]).toEqual({
      matcher: CACHE_ADVICE_HOOK_MATCHER,
      hooks: [
        {
          type: "command",
          command: "/opt/homebrew/bin/mega hooks cache-advice",
          timeout: 10,
        },
      ],
    });
    expect(s.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("repairs official script launchers in place, reports them, and uninstalls them", () => {
    const launchers = [
      "/opt/mega.mjs",
      "/opt/apps/cli/dist/cli.js",
      "/opt/@megasaver/cli/dist/cli.js",
      '"/opt/My App/mega.mjs"',
      '"/opt/My App/apps/cli/dist/cli.js"',
      '"/opt/My App/@megasaver/cli/dist/cli.js"',
    ];

    for (const launcher of launchers) {
      const command = (subcommand: string) =>
        `${launcher} hooks ${subcommand} --store "/tmp/store"`;
      const p = tmpSettings({
        hooks: {
          PreToolUse: [
            {
              matcher: HOOK_MATCHER,
              hooks: [{ type: "command", command: command("log"), timeout: 10 }],
            },
            {
              matcher: GUARD_HOOK_MATCHER,
              hooks: [{ type: "command", command: command("guard"), timeout: 10 }],
            },
          ],
          PostToolUse: [
            {
              matcher: SAVER_HOOK_MATCHER,
              hooks: [{ type: "command", command: command("saver"), timeout: 30 }],
            },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: command("intent"), timeout: 10 }] },
          ],
          SessionStart: [{ hooks: [{ type: "command", command: command("warmup"), timeout: 10 }] }],
        },
      });

      expect(
        installClaudeCodeHook({
          settingsPath: p,
          config: { cliPath: "/next/mega.mjs", storeRoot: "/tmp/store" },
          platform: POSIX_PLATFORM,
        }).changed,
      ).toBe(true);
      const installed = JSON.parse(readFileSync(p, "utf8"));
      expect(installed.hooks.PreToolUse).toHaveLength(3);
      expect(installed.hooks.PostToolUse).toHaveLength(1);
      expect(installed.hooks.UserPromptSubmit).toHaveLength(1);
      expect(installed.hooks.SessionStart).toHaveLength(2);
      expect(installed.hooks.PreCompact).toHaveLength(1);
      expect(readClaudeCodeHookStatus({ settingsPath: p })).toEqual({
        connected: true,
        preInstalled: true,
        postInstalled: true,
        intentInstalled: true,
        warmupInstalled: true,
        capsuleInstalled: true,
        recapInstalled: true,
        guardInstalled: true,
        cacheAdviceInstalled: true,
        meshHintInstalled: false,
        execRewriteInstalled: false,
        stopInstalled: false,
      });

      expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(true);
      expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({});
    }
  });

  it("separates the desired command from a co-located foreign hook without changing metadata", () => {
    const oldCommand = "/opt/mega.mjs hooks log";
    const desiredCommand = "/next/mega.mjs hooks log";
    const coLocatedForeign = { type: "command", command: "foreign colocated", timeout: 17 };
    const foreignEntry = {
      matcher: "ForeignTool",
      hooks: [{ type: "command", command: "foreign only", timeout: 23 }],
    };
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "ForeignMatcher",
            custom: "keep",
            arbitrary: { nested: true },
            hooks: [{ type: "command", command: oldCommand }, coLocatedForeign],
          },
          { matcher: "OwnedOnly", hooks: [{ type: "command", command: oldCommand }] },
          foreignEntry,
        ],
      },
    });

    installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/next/mega.mjs" },
      guard: false,
      warmup: false,
      platform: POSIX_PLATFORM,
    });

    const settings = JSON.parse(readFileSync(p, "utf8"));
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: HOOK_MATCHER,
        hooks: [{ type: "command", command: desiredCommand, timeout: 10 }],
      },
      {
        matcher: "ForeignMatcher",
        custom: "keep",
        arbitrary: { nested: true },
        hooks: [coLocatedForeign],
      },
      foreignEntry,
      {
        matcher: CACHE_ADVICE_HOOK_MATCHER,
        hooks: [{ type: "command", command: "/next/mega.mjs hooks cache-advice", timeout: 10 }],
      },
    ]);
  });

  it("migrates a pre-subcommand store-baked intent hook without duplicating it", () => {
    const p = tmpSettings({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: '/opt/homebrew/bin/mega --store "/data" hooks intent',
                timeout: 10,
              },
            ],
          },
        ],
      },
    });

    installClaudeCodeHook({
      settingsPath: p,
      config: { cliPath: "/opt/homebrew/bin/mega", storeRoot: "/data" },
      guard: false,
      warmup: false,
    });

    const settings = JSON.parse(readFileSync(p, "utf8"));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
      "/opt/homebrew/bin/mega hooks intent --store /data",
    );
  });

  it("preserves a foreign trailing-store wrapper through install and uninstall", () => {
    const foreignCommand = "custom-wrapper hooks saver --store /tmp";
    const p = tmpSettings({
      hooks: {
        PostToolUse: [
          {
            matcher: "CustomTool",
            hooks: [{ type: "command", command: foreignCommand, timeout: 30 }],
          },
        ],
      },
    });

    expect(hookCommandMatches(foreignCommand, "saver")).toBe(false);

    installClaudeCodeHook({ settingsPath: p, guard: false, warmup: false });
    let settings = JSON.parse(readFileSync(p, "utf8"));
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.PostToolUse[0]).toEqual({
      matcher: "CustomTool",
      hooks: [{ type: "command", command: foreignCommand, timeout: 30 }],
    });

    uninstallClaudeCodeHook({ settingsPath: p });
    settings = JSON.parse(readFileSync(p, "utf8"));
    expect(settings.hooks.PostToolUse).toEqual([
      {
        matcher: "CustomTool",
        hooks: [{ type: "command", command: foreignCommand, timeout: 30 }],
      },
    ]);
  });

  it("uninstall removes store-baked absolute forms too", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: HOOK_MATCHER,
            hooks: [{ type: "command", command: "/opt/homebrew/bin/mega hooks log", timeout: 10 }],
          },
        ],
        PostToolUse: [
          {
            matcher: SAVER_HOOK_MATCHER,
            hooks: [
              {
                type: "command",
                command: '/opt/homebrew/bin/mega --store "/data" hooks saver',
                timeout: 30,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "/opt/homebrew/bin/mega hooks intent", timeout: 10 },
            ],
          },
        ],
      },
    });
    const r = uninstallClaudeCodeHook({ settingsPath: p });
    expect(r.changed).toBe(true);
    const s = JSON.parse(readFileSync(p, "utf8"));
    expect(s.hooks).toBeUndefined();
  });
});

describe("exec-rewrite hook", () => {
  it("adds its own PreToolUse entry with matcher ^Bash$ and timeout 10", () => {
    const next = addExecRewriteHook({}, EXEC_REWRITE_HOOK_COMMAND) as {
      hooks: {
        PreToolUse: Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>;
      };
    };
    expect(next.hooks.PreToolUse[0]?.matcher).toBe(EXEC_REWRITE_HOOK_MATCHER);
    expect(next.hooks.PreToolUse[0]?.hooks?.[0]).toEqual({
      type: "command",
      command: EXEC_REWRITE_HOOK_COMMAND,
      timeout: 10,
    });
  });

  it("has/add/remove round-trips without touching other PreToolUse entries", () => {
    const withGuard = addGuardHook({}, GUARD_HOOK_COMMAND);
    expect(hasExecRewriteHook(withGuard, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    const added = addExecRewriteHook(withGuard, EXEC_REWRITE_HOOK_COMMAND);
    expect(hasExecRewriteHook(added, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    const removed = removeExecRewriteHook(added, EXEC_REWRITE_HOOK_COMMAND);
    expect(hasExecRewriteHook(removed, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    expect(hasGuardHook(removed, GUARD_HOOK_COMMAND)).toBe(true);
  });

  it("install tri-state: true adds, absent preserves, false removes", () => {
    const p = join(mkdtempSync(join(tmpdir(), "mega-hooks-")), "settings.json");
    installClaudeCodeHook({ settingsPath: p, execRewrite: true });
    let written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    installClaudeCodeHook({ settingsPath: p }); // absent → preserved
    written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(true);
    installClaudeCodeHook({ settingsPath: p, execRewrite: false });
    written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
  });

  it("uninstall removes the exec-rewrite entry; status reports it", () => {
    const p = join(mkdtempSync(join(tmpdir(), "mega-hooks-")), "settings.json");
    installClaudeCodeHook({ settingsPath: p, execRewrite: true });
    expect(readClaudeCodeHookStatus({ settingsPath: p }).execRewriteInstalled).toBe(true);
    uninstallClaudeCodeHook({ settingsPath: p });
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(hasExecRewriteHook(written, EXEC_REWRITE_HOOK_COMMAND)).toBe(false);
    expect(readClaudeCodeHookStatus({ settingsPath: p }).execRewriteInstalled).toBe(false);
  });
});
