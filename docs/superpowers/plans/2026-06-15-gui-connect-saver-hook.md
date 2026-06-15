# GUI "Connect Saver hook" Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app toggle that installs/uninstalls the global Claude Code Mega Saver hooks (`~/.claude/settings.json`) in the background, replacing the terminal-only `mega hooks install claude-code`.

**Architecture:** Move the hook-settings logic from `apps/cli` into `@megasaver/connector-claude-code` (the only package both CLI and GUI bridge may import), add uninstall + status functions, expose a global bridge route `/api/hooks/claude-code` (GET/POST/DELETE), add client calls, and render a `HookConnection` toggle in the Token saver panel. The settings-mutation logic is pure and unit-tested; the bridge route gets an injectable `claudeSettingsPath` for tests.

**Tech Stack:** TypeScript (strict, ESM), Vitest, React 18, Citty (CLI), Zod, Biome, pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-15-gui-connect-saver-hook-design.md`

**Working dir:** worktree `/.worktrees/gui-connect-saver-hook` on branch `feat/gui-connect-saver-hook`. Run `pnpm install` once before starting; run `pnpm build` once so workspace dep `dist/` exist (vitest resolves packages by their built entry).

---

## File Structure

**Create:**
- `packages/connectors/claude-code/src/hook-settings.ts` — pure hook-settings logic (moved + new uninstall/status).
- `packages/connectors/claude-code/test/hook-settings.test.ts` — pure-fn unit tests.
- `apps/cli/src/commands/hooks/uninstall.ts` — `mega hooks uninstall claude-code`.
- `apps/cli/test/hooks/uninstall.test.ts` — CLI uninstall unit test.
- `apps/gui/bridge/routes/claude-hooks.ts` — global hook route + dispatcher.
- `apps/gui/test/bridge/claude-hooks-route.test.ts` — bridge HTTP tests.
- `apps/gui/src/views/cockpit/hook-connection.tsx` — toggle component.
- `apps/gui/test/components/hook-connection.test.tsx` — component tests.
- `.changeset/gui-connect-saver-hook.md` — version bumps.

**Modify:**
- `packages/connectors/claude-code/src/index.ts` — re-export the public hook-settings surface.
- `apps/cli/src/commands/hooks/install.ts` — import moved fns from the package; drop local copies.
- `apps/cli/src/commands/hooks/settings-path.ts` — re-export `resolveClaudeCodeSettingsPath` from the package.
- `apps/cli/src/commands/hooks/index.ts` — register `hooksUninstallCommand`.
- `apps/gui/package.json` — add `@megasaver/connector-claude-code` dependency.
- `apps/gui/bridge/route-context.ts` — add `claudeSettingsPath: string`.
- `apps/gui/bridge/handler.ts` — resolve/inject `claudeSettingsPath`; register `dispatchClaudeHooks`.
- `apps/gui/src/lib/claude-sessions-client.ts` — add hook client fns + `ClaudeHookStatus` type.
- `apps/gui/src/views/cockpit/token-saver-panel.tsx` — render `<HookConnection/>`.

---

## Task 1: Extract & extend hook-settings in `@megasaver/connector-claude-code`

**Files:**
- Create: `packages/connectors/claude-code/src/hook-settings.ts`
- Test: `packages/connectors/claude-code/test/hook-settings.test.ts`
- Modify: `packages/connectors/claude-code/src/index.ts`

The current definitions live in `apps/cli/src/commands/hooks/install.ts:14-111` (constants, `hasPreToolUseHook`, `addPreToolUseHook`, `hasPostToolUseHook`, `addPostToolUseHook`, `installClaudeCodeHook`) and `apps/cli/src/commands/hooks/settings-path.ts` (`resolveClaudeCodeSettingsPath`). This task copies them into the package verbatim and adds `removePreToolUseHook`, `removePostToolUseHook`, `uninstallClaudeCodeHook`, `readClaudeCodeHookStatus`.

- [ ] **Step 1: Write the failing test**

Create `packages/connectors/claude-code/test/hook-settings.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("uninstall on a file without the entries is a no-op", () => {
    const p = tmpSettings({ model: "x" });
    expect(uninstallClaudeCodeHook({ settingsPath: p }).changed).toBe(false);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ model: "x" });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/connector-claude-code test`
Expected: FAIL — cannot resolve `../src/hook-settings.js` (module not created yet).

- [ ] **Step 3: Create the implementation**

Create `packages/connectors/claude-code/src/hook-settings.ts`. The first ~80 lines are copied verbatim from `apps/cli/src/commands/hooks/install.ts:14-111` (constants + has/add fns + `installClaudeCodeHook`); the `resolveClaudeCodeSettingsPath` body is copied from `apps/cli/src/commands/hooks/settings-path.ts`. New code is the `remove*`, `uninstallClaudeCodeHook`, and `readClaudeCodeHookStatus` functions.

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const HOOK_MATCHER = "Read|Bash|Grep|Glob|LS";
export const DEFAULT_HOOK_COMMAND = "mega hooks log";
export const SAVER_HOOK_COMMAND = "mega hooks saver";
export const SAVER_HOOK_MATCHER = "Read|Bash|Grep|Glob|LS";

type CommandHook = { type: "command"; command: string };
type ToolUseEntry = { matcher?: string; hooks?: CommandHook[] };
type SettingsObject = {
  hooks?: { PreToolUse?: unknown; PostToolUse?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

function asSettings(value: unknown): SettingsObject {
  return typeof value === "object" && value !== null ? { ...(value as SettingsObject) } : {};
}

function entryReferencesCommand(entry: unknown, command: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as ToolUseEntry).hooks;
  return Array.isArray(hooks) && hooks.some((h) => h?.command === command);
}

export function hasPreToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryReferencesCommand(e, command));
}

export function addPreToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasPreToolUseHook(next, command)) return next;
  const hooks = next.hooks ? { ...next.hooks } : {};
  const existingPre = hooks.PreToolUse;
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function hasPostToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const post = (settings as SettingsObject).hooks?.PostToolUse;
  return Array.isArray(post) && post.some((e) => entryReferencesCommand(e, command));
}

export function addPostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  if (hasPostToolUseHook(next, command)) return next;
  const hooks = next.hooks ? { ...next.hooks } : {};
  const existingPost = (hooks as { PostToolUse?: unknown }).PostToolUse;
  const post = Array.isArray(existingPost) ? [...(existingPost as ToolUseEntry[])] : [];
  post.push({ matcher: SAVER_HOOK_MATCHER, hooks: [{ type: "command", command }] });
  next.hooks = { ...hooks, PostToolUse: post };
  return next;
}

// Drops the hooks-array key from `next.hooks` when empty, and the whole `hooks`
// key when it has no remaining entries — so a clean uninstall leaves no residue.
function pruneHooks(next: SettingsObject, key: "PreToolUse" | "PostToolUse", kept: ToolUseEntry[]) {
  const hooks = { ...(next.hooks ?? {}) };
  if (kept.length > 0) {
    hooks[key] = kept;
  } else {
    delete hooks[key];
  }
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  } else {
    next.hooks = hooks;
  }
}

export function removePreToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = (existing as ToolUseEntry[]).filter((e) => !entryReferencesCommand(e, command));
  pruneHooks(next, "PreToolUse", kept);
  return next;
}

export function removePostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PostToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = (existing as ToolUseEntry[]).filter((e) => !entryReferencesCommand(e, command));
  pruneHooks(next, "PostToolUse", kept);
  return next;
}

export type InstallClaudeCodeHookInput = { settingsPath: string; command?: string };
export type ClaudeCodeHookResult = { settingsPath: string; changed: boolean };

function readSettings(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

function writeSettings(settingsPath: string, settings: SettingsObject): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

export function installClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  const existing = readSettings(input.settingsPath);
  if (hasPreToolUseHook(existing, command) && hasPostToolUseHook(existing, SAVER_HOOK_COMMAND)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, SAVER_HOOK_COMMAND);
  writeSettings(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}

export function uninstallClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  if (!existsSync(input.settingsPath)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  const existing = readSettings(input.settingsPath);
  if (!hasPreToolUseHook(existing, command) && !hasPostToolUseHook(existing, SAVER_HOOK_COMMAND)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = removePreToolUseHook(existing, command);
  next = removePostToolUseHook(next, SAVER_HOOK_COMMAND);
  writeSettings(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}

export type ClaudeCodeHookStatus = {
  connected: boolean;
  preInstalled: boolean;
  postInstalled: boolean;
};

export function readClaudeCodeHookStatus(input: InstallClaudeCodeHookInput): ClaudeCodeHookStatus {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  let settings: unknown;
  try {
    settings = readSettings(input.settingsPath);
  } catch {
    return { connected: false, preInstalled: false, postInstalled: false };
  }
  const preInstalled = hasPreToolUseHook(settings, command);
  const postInstalled = hasPostToolUseHook(settings, SAVER_HOOK_COMMAND);
  return { connected: preInstalled && postInstalled, preInstalled, postInstalled };
}

export function resolveClaudeCodeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return join(home, ".claude", "settings.json");
}
```

NOTE on `resolveClaudeCodeSettingsPath`: the CLI version delegates to `resolveHomeDir(env)` from `apps/cli/src/store.ts`. The package cannot import from `apps/cli`. If `resolveHomeDir` exists in a shared package, import it; otherwise the inline `env.HOME ?? env.USERPROFILE ?? homedir()` above matches its behaviour. Confirm against `apps/cli/src/store.ts:resolveHomeDir` during implementation and mirror it exactly.

- [ ] **Step 4: Add exports to the package index**

Append to `packages/connectors/claude-code/src/index.ts`:

```ts
export {
  HOOK_MATCHER,
  DEFAULT_HOOK_COMMAND,
  SAVER_HOOK_COMMAND,
  SAVER_HOOK_MATCHER,
  hasPreToolUseHook,
  addPreToolUseHook,
  hasPostToolUseHook,
  addPostToolUseHook,
  removePreToolUseHook,
  removePostToolUseHook,
  installClaudeCodeHook,
  uninstallClaudeCodeHook,
  readClaudeCodeHookStatus,
  resolveClaudeCodeSettingsPath,
  type InstallClaudeCodeHookInput,
  type ClaudeCodeHookResult,
  type ClaudeCodeHookStatus,
} from "./hook-settings.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/connector-claude-code test`
Expected: PASS (all hook-settings cases green).

- [ ] **Step 6: Rebuild the package so downstream consumers resolve the new exports**

Run: `pnpm --filter @megasaver/connector-claude-code build`
Expected: emits `dist/` with the new exports.

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/claude-code/src/hook-settings.ts \
        packages/connectors/claude-code/test/hook-settings.test.ts \
        packages/connectors/claude-code/src/index.ts
git commit -m "feat(connector-claude-code): hook-settings install/uninstall/status"
```

---

## Task 2: Re-point CLI to the package + add `hooks uninstall`

**Files:**
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Modify: `apps/cli/src/commands/hooks/settings-path.ts`
- Create: `apps/cli/src/commands/hooks/uninstall.ts`
- Modify: `apps/cli/src/commands/hooks/index.ts`
- Create: `apps/cli/test/hooks/uninstall.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/hooks/uninstall.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHooksUninstall } from "../../src/commands/hooks/uninstall.js";

function tmpSettings(initial: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "ms-cli-uninstall-")), "settings.json");
  writeFileSync(p, `${JSON.stringify(initial, null, 2)}\n`);
  return p;
}

describe("runHooksUninstall", () => {
  it("removes Mega Saver hooks and returns 0", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [{ matcher: "Read|Bash|Grep|Glob|LS", hooks: [{ type: "command", command: "mega hooks log" }] }],
        PostToolUse: [{ matcher: "Read|Bash|Grep|Glob|LS", hooks: [{ type: "command", command: "mega hooks saver" }] }],
      },
    });
    const out: string[] = [];
    const code = runHooksUninstall({
      target: "claude-code",
      settingsPath: p,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json: false,
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({});
  });

  it("rejects an unknown target with exit 1", () => {
    const errs: string[] = [];
    const code = runHooksUninstall({
      target: "cursor",
      settingsPath: "/tmp/x.json",
      stdout: () => {},
      stderr: (l) => errs.push(l),
      json: false,
    });
    expect(code).toBe(1);
    expect(errs[0]).toContain("unknown hook target");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/uninstall.test.ts`
Expected: FAIL — cannot resolve `../../src/commands/hooks/uninstall.js`.

- [ ] **Step 3: Create `uninstall.ts`**

Create `apps/cli/src/commands/hooks/uninstall.ts`:

```ts
import { defineCommand } from "citty";
import {
  type ClaudeCodeHookResult,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";

export type RunHooksUninstallInput = {
  target: string;
  settingsPath: string;
  command?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export function runHooksUninstall(input: RunHooksUninstallInput): 0 | 1 {
  if (input.target !== "claude-code") {
    input.stderr(`error: unknown hook target "${input.target}" (supported: claude-code)`);
    return 1;
  }
  let result: ClaudeCodeHookResult;
  try {
    result = uninstallClaudeCodeHook({
      settingsPath: input.settingsPath,
      ...(input.command !== undefined ? { command: input.command } : {}),
    });
  } catch (err) {
    input.stderr(
      `error: could not uninstall Claude Code hook at ${input.settingsPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  if (input.json) {
    input.stdout(JSON.stringify({ target: input.target, ...result }));
  } else {
    input.stdout(
      result.changed
        ? `Removed Claude Code Mega Saver hooks at ${result.settingsPath}`
        : `No Claude Code Mega Saver hooks found at ${result.settingsPath} (no-op)`,
    );
  }
  return 0;
}

export const hooksUninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove the Claude Code Mega Saver hooks (telemetry + saver).",
  },
  args: {
    target: { type: "positional", required: true, description: "Hook target (claude-code)." },
    settings: { type: "string", description: "Override Claude Code settings.json path." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  run({ args }) {
    const code = runHooksUninstall({
      target: typeof args.target === "string" ? args.target : "",
      settingsPath:
        typeof args.settings === "string" ? args.settings : resolveClaudeCodeSettingsPath(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Re-point `install.ts` to the package**

In `apps/cli/src/commands/hooks/install.ts`, delete the local definitions of `HOOK_MATCHER`, `DEFAULT_HOOK_COMMAND`, `SAVER_HOOK_COMMAND`, `SAVER_HOOK_MATCHER`, `SettingsObject`/helper types, `hasPreToolUseHook`, `addPreToolUseHook`, `hasPostToolUseHook`, `addPostToolUseHook`, `installClaudeCodeHook`, and the related `InstallClaudeCodeHookInput`/`InstallClaudeCodeHookResult` types. Replace with an import, keeping `runHooksInstall` + `hooksInstallCommand` (and their behaviour/output strings) intact:

```ts
import { defineCommand } from "citty";
import {
  type ClaudeCodeHookResult,
  installClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { resolveClaudeCodeSettingsPath } from "./settings-path.js";
```

Update `runHooksInstall`'s local type to use `ClaudeCodeHookResult` (was `InstallClaudeCodeHookResult`). Keep the exact stdout strings at `install.ts:146-148`.

If any other file imported the moved symbols from `install.ts` (check with `grep -rn "from .*hooks/install" apps packages`), re-point those imports to `@megasaver/connector-claude-code`.

- [ ] **Step 5: Re-point `settings-path.ts` to the package**

Replace `apps/cli/src/commands/hooks/settings-path.ts` contents with a re-export so existing import sites keep working:

```ts
export { resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";
```

- [ ] **Step 6: Register the uninstall command**

In `apps/cli/src/commands/hooks/index.ts`, import `hooksUninstallCommand` and add it to the `subCommands` map (alongside `install`, `log`, `saver`, `status`) under key `uninstall`. Match the existing registration style in that file.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli exec vitest run test/hooks/`
Expected: PASS — new `uninstall.test.ts` plus the pre-existing install/status tests all green (install behaviour unchanged).

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/hooks/ apps/cli/test/hooks/uninstall.test.ts
git commit -m "feat(cli): hooks uninstall + reuse connector hook-settings"
```

---

## Task 3: Bridge — inject `claudeSettingsPath`, add `/api/hooks/claude-code`

**Files:**
- Modify: `apps/gui/package.json`
- Modify: `apps/gui/bridge/route-context.ts`
- Modify: `apps/gui/bridge/handler.ts`
- Create: `apps/gui/bridge/routes/claude-hooks.ts`
- Create: `apps/gui/test/bridge/claude-hooks-route.test.ts`

- [ ] **Step 1: Add the package dependency**

In `apps/gui/package.json` `dependencies`, add:

```json
"@megasaver/connector-claude-code": "workspace:*",
```

Run `pnpm install` to link it.

- [ ] **Step 2: Add `claudeSettingsPath` to RouteContext**

In `apps/gui/bridge/route-context.ts`, add to the `RouteContext` type (after `claudeSessionsMetaDir`):

```ts
  // Absolute path to ~/.claude/settings.json (overridable in tests). Target of
  // the global Claude Code hook connect/disconnect route.
  claudeSettingsPath: string;
```

- [ ] **Step 3: Write the failing bridge test**

Create `apps/gui/test/bridge/claude-hooks-route.test.ts`. Mirror the harness in `apps/gui/test/bridge/workspace-saver-route.test.ts` (study it for how a bridge handler/server is started and how `claudeSettingsPath` can be injected — pass it through the same options object the other tests use; if that test builds the handler via `createBridgeHandler`, pass `claudeSettingsPath` as a new option there):

```ts
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestBridge } from "./helpers/start-test-bridge.js"; // use the SAME helper the other bridge tests use

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});

async function bridgeWithSettings(): Promise<{ baseUrl: string; settingsPath: string }> {
  const settingsPath = join(mkdtempSync(join(tmpdir(), "ms-bridge-hooks-")), "settings.json");
  const started = await startTestBridge({ claudeSettingsPath: settingsPath });
  close = started.close;
  return { baseUrl: started.baseUrl, settingsPath };
}

describe("GET/POST/DELETE /api/hooks/claude-code", () => {
  it("reports disconnected on a fresh settings path", async () => {
    const { baseUrl } = await bridgeWithSettings();
    const res = await fetch(`${baseUrl}/api/hooks/claude-code`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false, preInstalled: false, postInstalled: false });
  });

  it("POST connects (installs both hooks); GET then reports connected", async () => {
    const { baseUrl, settingsPath } = await bridgeWithSettings();
    const post = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "POST" });
    expect(post.status).toBe(200);
    expect((await post.json()).connected).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    const get = await fetch(`${baseUrl}/api/hooks/claude-code`);
    expect((await get.json()).connected).toBe(true);
  });

  it("DELETE disconnects (removes the hooks)", async () => {
    const { baseUrl, settingsPath } = await bridgeWithSettings();
    await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "POST" });
    const del = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()).connected).toBe(false);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({});
  });

  it("rejects an unsupported method with 405", async () => {
    const { baseUrl } = await bridgeWithSettings();
    const res = await fetch(`${baseUrl}/api/hooks/claude-code`, { method: "PUT" });
    expect(res.status).toBe(405);
  });
});
```

If the existing bridge test helper is inline (not a shared `start-test-bridge.js`), copy its exact start/stop pattern into this file instead of importing, and extend the `createBridgeHandler(...)` options it uses with `claudeSettingsPath`.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/claude-hooks-route.test.ts`
Expected: FAIL — route returns 404 (handler not wired) and/or `claudeSettingsPath` option not accepted.

- [ ] **Step 5: Create the route module**

Create `apps/gui/bridge/routes/claude-hooks.ts`:

```ts
import {
  installClaudeCodeHook,
  readClaudeCodeHookStatus,
  uninstallClaudeCodeHook,
} from "@megasaver/connector-claude-code";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";

const HOOKS_PATH = /^\/api\/hooks\/claude-code$/;

export async function dispatchClaudeHooks(
  ctx: RouteContext,
  method: string,
  path: string,
  onMethodNotAllowed: () => void,
): Promise<boolean> {
  if (!HOOKS_PATH.test(path)) return false;
  try {
    if (method === "GET") {
      const status = readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(ctx.res, 200, status, ctx.origin);
      return true;
    }
    if (method === "POST") {
      installClaudeCodeHook({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(
        ctx.res,
        200,
        readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath }),
        ctx.origin,
      );
      return true;
    }
    if (method === "DELETE") {
      uninstallClaudeCodeHook({ settingsPath: ctx.claudeSettingsPath });
      ctx.sendJson(
        ctx.res,
        200,
        readClaudeCodeHookStatus({ settingsPath: ctx.claudeSettingsPath }),
        ctx.origin,
      );
      return true;
    }
    onMethodNotAllowed();
    return true;
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
    return true;
  }
}
```

- [ ] **Step 6: Wire it into `handler.ts`**

In `apps/gui/bridge/handler.ts`:

1. Add the import:
```ts
import { resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";
import { dispatchClaudeHooks } from "./routes/claude-hooks.js";
```
2. Add the option to `BridgeHandlerOptions`:
```ts
  /** Override for tests; defaults to ~/.claude/settings.json. */
  claudeSettingsPath?: string;
```
3. In `createBridgeHandler`, resolve it (near the other path defaults, ~line 117):
```ts
  const claudeSettingsPath = opts.claudeSettingsPath ?? resolveClaudeCodeSettingsPath();
```
4. Add `claudeSettingsPath` to the `ctx` object literal (~line 159-174).
5. Register the dispatcher — place this block before the final `sendError(... 404 ...)` (after the `path.startsWith("/api/mcp/")` block is a good spot since it is also a global, non-session route):
```ts
    if (path === "/api/hooks/claude-code") {
      const dispatched = await dispatchClaudeHooks(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/claude-hooks-route.test.ts`
Expected: PASS — GET/POST/DELETE + 405 all green.

- [ ] **Step 8: Commit**

```bash
git add apps/gui/package.json apps/gui/bridge/ apps/gui/test/bridge/claude-hooks-route.test.ts
git commit -m "feat(gui): bridge route /api/hooks/claude-code connect/disconnect"
```

---

## Task 4: Client functions

**Files:**
- Modify: `apps/gui/src/lib/claude-sessions-client.ts`

The client already defines `getJson<T>` (`claude-sessions-client.ts:65`) and `mutateJson<T>` (`:80`). Add typed wrappers for the global hook route.

- [ ] **Step 1: Write the failing test**

Create/extend `apps/gui/test/lib/claude-hooks-client.test.ts` (if a `test/lib` pattern exists; otherwise place under `apps/gui/test/`). Mock `fetch`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectClaudeHook,
  disconnectClaudeHook,
  fetchClaudeHookStatus,
} from "../../src/lib/claude-sessions-client.js";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })));
}

describe("claude hook client", () => {
  it("fetchClaudeHookStatus GETs the global route", async () => {
    mockFetch({ connected: true, preInstalled: true, postInstalled: true });
    const status = await fetchClaudeHookStatus();
    expect(status.connected).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/hooks/claude-code");
  });

  it("connectClaudeHook POSTs", async () => {
    mockFetch({ connected: true, preInstalled: true, postInstalled: true });
    await connectClaudeHook();
    expect(fetch).toHaveBeenCalledWith("/api/hooks/claude-code", expect.objectContaining({ method: "POST" }));
  });

  it("disconnectClaudeHook DELETEs", async () => {
    mockFetch({ connected: false, preInstalled: false, postInstalled: false });
    await disconnectClaudeHook();
    expect(fetch).toHaveBeenCalledWith("/api/hooks/claude-code", expect.objectContaining({ method: "DELETE" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui exec vitest run test/lib/claude-hooks-client.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Add the client functions**

Append to `apps/gui/src/lib/claude-sessions-client.ts` (after the existing exported fns; reuse the file's `getJson`/`mutateJson`):

```ts
export type ClaudeHookStatus = {
  connected: boolean;
  preInstalled: boolean;
  postInstalled: boolean;
};

export function fetchClaudeHookStatus(): Promise<ClaudeHookStatus> {
  return getJson<ClaudeHookStatus>("/api/hooks/claude-code");
}

export function connectClaudeHook(): Promise<ClaudeHookStatus> {
  return mutateJson<ClaudeHookStatus>("/api/hooks/claude-code", "POST");
}

export function disconnectClaudeHook(): Promise<ClaudeHookStatus> {
  return mutateJson<ClaudeHookStatus>("/api/hooks/claude-code", "DELETE");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui exec vitest run test/lib/claude-hooks-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/lib/claude-sessions-client.ts apps/gui/test/lib/claude-hooks-client.test.ts
git commit -m "feat(gui): client calls for hook connect/disconnect/status"
```

---

## Task 5: `HookConnection` toggle component + panel wiring

**Files:**
- Create: `apps/gui/src/views/cockpit/hook-connection.tsx`
- Create: `apps/gui/test/components/hook-connection.test.tsx`
- Modify: `apps/gui/src/views/cockpit/token-saver-panel.tsx`

Mirror the state/loading pattern of `apps/gui/src/views/cockpit/saver-mode-activation.tsx`.

- [ ] **Step 1: Write the failing component test**

Create `apps/gui/test/components/hook-connection.test.tsx`. Mirror the mocking style of `apps/gui/test/components/token-saver-panel.test.tsx` (`vi.mock("../../src/lib/claude-sessions-client.js", ...)`):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HookConnection } from "../../src/views/cockpit/hook-connection.js";

const fetchStatus = vi.fn();
const connect = vi.fn();
const disconnect = vi.fn();
vi.mock("../../src/lib/claude-sessions-client.js", () => ({
  fetchClaudeHookStatus: () => fetchStatus(),
  connectClaudeHook: () => connect(),
  disconnectClaudeHook: () => disconnect(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const OFF = { connected: false, preInstalled: false, postInstalled: false };
const ON = { connected: true, preInstalled: true, postInstalled: true };

describe("HookConnection", () => {
  it("renders disconnected then connects on check", async () => {
    fetchStatus.mockResolvedValue(OFF);
    connect.mockResolvedValue(ON);
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
  });

  it("confirms before disconnect; cancel does nothing", async () => {
    fetchStatus.mockResolvedValue(ON);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("disconnects when confirmed", async () => {
    fetchStatus.mockResolvedValue(ON);
    disconnect.mockResolvedValue(OFF);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<HookConnection />);
    const box = await screen.findByRole("checkbox");
    fireEvent.click(box);
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });

  it("shows the global-scope note", async () => {
    fetchStatus.mockResolvedValue(OFF);
    render(<HookConnection />);
    expect(await screen.findByText(/all Claude Code sessions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui exec vitest run test/components/hook-connection.test.tsx`
Expected: FAIL — `HookConnection` not defined.

- [ ] **Step 3: Create the component**

Create `apps/gui/src/views/cockpit/hook-connection.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type ClaudeHookStatus,
  connectClaudeHook,
  disconnectClaudeHook,
  fetchClaudeHookStatus,
} from "../../lib/claude-sessions-client.js";

const DISCONNECT_WARNING =
  "Disconnect the Mega Saver hook? This removes it for ALL Claude Code sessions on this machine.";

export function HookConnection(): JSX.Element {
  const [status, setStatus] = useState<ClaudeHookStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [actionError, setActionError] = useState<BridgeError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setStatus(await fetchClaudeHookStatus());
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (next: boolean) => {
    if (!next && !window.confirm(DISCONNECT_WARNING)) return;
    setBusy(true);
    setActionError(null);
    try {
      setStatus(next ? await connectClaudeHook() : await disconnectClaudeHook());
    } catch (err) {
      setActionError(err as BridgeError);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs text-text-muted uppercase tracking-widest">Saver hook</h3>
      <p className="text-xs text-text-muted">
        Connecting installs the Mega Saver hooks into Claude Code. This applies to all Claude Code
        sessions on this machine.
      </p>
      {state === "loading" && <LoadingState label="Loading hook status..." />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && status && (
        <>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={status.connected}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Saver hook {status.connected ? "connected" : "disconnected"}
          </label>
          {actionError && (
            <p className="text-xs text-danger">Could not update the hook — try again.</p>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui exec vitest run test/components/hook-connection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render it in the Token saver panel**

In `apps/gui/src/views/cockpit/token-saver-panel.tsx`:
1. Import: `import { HookConnection } from "./hook-connection.js";`
2. Render `<HookConnection />` just above the existing `<SaverModeActivation dir=... id=... />` usage (so "connect hook" sits above "Saver Mode" in the panel).

- [ ] **Step 6: Run the panel test to confirm no regression**

Run: `pnpm --filter @megasaver/gui exec vitest run test/components/token-saver-panel.test.tsx`
Expected: PASS (existing assertions unaffected; `HookConnection` mounts and loads its own status — if the panel test does not mock the hook client fns, add `fetchClaudeHookStatus` to its `vi.mock` of the client returning `{connected:false,...}` so the new child does not throw).

- [ ] **Step 7: Commit**

```bash
git add apps/gui/src/views/cockpit/hook-connection.tsx \
        apps/gui/test/components/hook-connection.test.tsx \
        apps/gui/src/views/cockpit/token-saver-panel.tsx
git commit -m "feat(gui): HookConnection toggle in token-saver panel"
```

---

## Task 6: Changeset, full verify, smoke evidence

**Files:**
- Create: `.changeset/gui-connect-saver-hook.md`

- [ ] **Step 1: Add the changeset**

Create `.changeset/gui-connect-saver-hook.md`:

```md
---
"@megasaver/connector-claude-code": minor
"@megasaver/cli": patch
"@megasaver/gui": patch
---

Add an in-app "Connect Saver hook" toggle. The Token saver panel can now
install/uninstall the global Claude Code Mega Saver hooks
(`~/.claude/settings.json`) in the background, replacing the terminal-only
`mega hooks install claude-code`. Hook-settings logic moved into
`@megasaver/connector-claude-code` (new `uninstall`/`status` functions),
exposed via a global bridge route `/api/hooks/claude-code` (GET/POST/DELETE)
and a symmetric CLI `mega hooks uninstall claude-code`.
```

- [ ] **Step 2: Run the full verify gate**

Run: `pnpm verify`
Expected: lint + typecheck + all tests green across the workspace. (If the pre-existing, unrelated `apps/cli` e2e `v1-closeout-flow.test.ts` is still red on `main`, confirm it fails identically without this branch's changes and note it — it is out of scope for this feature. Re-check current `origin/main` status; #140 did not touch it.)

- [ ] **Step 3: Smoke evidence (manual, captured)**

Run the CLI against a temp settings file to prove connect/disconnect end-to-end without touching the real `~/.claude/settings.json`:

```bash
T=$(mktemp -d)/settings.json
pnpm --filter @megasaver/cli exec mega hooks install claude-code --settings "$T" --json
# expect changed:true; file now has PreToolUse "mega hooks log" + PostToolUse "mega hooks saver"
pnpm --filter @megasaver/cli exec mega hooks uninstall claude-code --settings "$T" --json
# expect changed:true; file back to {} (or hooks key removed)
```

Capture both outputs in the PR description. (The bridge route exercises the same functions; the bridge HTTP tests in Task 3 are the route-level evidence.)

- [ ] **Step 4: Commit the changeset**

```bash
git add .changeset/gui-connect-saver-hook.md
git commit -m "chore: changeset for connect-saver-hook toggle"
```

---

## Post-implementation (per CLAUDE.md §4/§9)

- External review: dispatch `code-reviewer` AND `critic` in fresh contexts (author ≠ reviewer). The critic's focus: the `uninstallClaudeCodeHook` / `removePre|PostToolUseHook` "preserve every unrelated hook and settings key" guarantee.
- Address review feedback (use `superpowers:receiving-code-review`).
- Then `superpowers:finishing-a-development-branch` → push, PR, CI, merge.

## Self-review (plan vs spec)

- Spec §Architecture 1 (connector hook-settings move + new fns) → Task 1. ✓
- Spec §Architecture 2 (CLI re-point + uninstall command) → Task 2. ✓
- Spec §Architecture 3 (RouteContext path, route, dispatcher, gui dep) → Task 3. ✓
- Spec §Architecture 4 (client fns) → Task 4. ✓
- Spec §Architecture 5 (HookConnection component + panel) → Task 5. ✓
- Spec §Testing (connector / bridge / component / CLI) → Tasks 1, 3, 4, 5, 2. ✓
- Spec §Error handling (malformed→false, write→500, preserve keys, idempotent) → Task 1 tests + Task 3 route. ✓
- Spec §DoD (changeset bumps, verify, smoke, reviewers) → Task 6 + Post-implementation. ✓
- Type consistency: `ClaudeHookStatus` (client) mirrors `ClaudeCodeHookStatus` (connector) field-for-field; `ClaudeCodeHookResult` replaces the old `InstallClaudeCodeHookResult` everywhere it is used. ✓
- No placeholders: every code step contains complete code. The only deferred detail is the exact test-bridge harness shape (Task 3 Step 3), which instructs the implementer to mirror the existing `workspace-saver-route.test.ts` harness — acceptable since that harness already exists in-repo.
