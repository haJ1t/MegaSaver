import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HOOK_MATCHER = "Read|Bash|Grep|Glob|LS";
export const DEFAULT_HOOK_COMMAND = "mega hooks log";
export const SAVER_HOOK_COMMAND = "mega hooks saver";
export const SAVER_HOOK_MATCHER = "Read|Bash|Grep|Glob|LS|WebFetch";

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

// Returns `next` with the kept entries written back under `key`, dropping that
// hooks-array key when empty and the whole `hooks` key when no entries remain —
// so a clean uninstall leaves no residue.
function pruneHooks(
  next: SettingsObject,
  key: "PreToolUse" | "PostToolUse",
  kept: ToolUseEntry[],
): SettingsObject {
  const hooks = { ...(next.hooks ?? {}) };
  if (kept.length > 0) {
    hooks[key] = kept;
  } else {
    delete hooks[key];
  }
  if (Object.keys(hooks).length === 0) {
    const { hooks: _dropped, ...rest } = next;
    return rest;
  }
  return { ...next, hooks };
}

// Strips `command` at the hook level, not the entry level: an entry that also
// holds unrelated user commands keeps them (only the matching CommandHook is
// dropped); an entry left with no hooks is removed. Entries without a hooks
// array (or non-object entries) pass through untouched.
function stripCommand(entries: ToolUseEntry[], command: string): ToolUseEntry[] {
  const kept: ToolUseEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter((h) => h?.command !== command);
    if (hooks.length === entry.hooks.length) {
      kept.push(entry);
    } else if (hooks.length > 0) {
      kept.push({ ...entry, hooks });
    }
  }
  return kept;
}

export function removePreToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], command);
  return pruneHooks(next, "PreToolUse", kept);
}

export function removePostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PostToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], command);
  return pruneHooks(next, "PostToolUse", kept);
}

export type InstallClaudeCodeHookInput = { settingsPath: string; command?: string };
export type ClaudeCodeHookResult = { settingsPath: string; changed: boolean };

function readSettings(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

// Atomic write: a global user file (~/.claude/settings.json) must never be left
// truncated by a crash mid-write. Write a sibling temp file, then rename() over
// the target — rename is atomic within a filesystem, so a reader sees either the
// old file or the complete new one, never a partial.
function writeSettings(settingsPath: string, settings: SettingsObject): void {
  const dir = dirname(settingsPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(tempPath, settingsPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
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

// Mirrors apps/cli/src/store.ts resolveHomeDir exactly: Windows has no HOME →
// fall back to USERPROFILE, then "" (NOT os.homedir()). SAFETY: the only place
// the real ~/.claude path is named; every test injects a temp settings path.
export function resolveClaudeCodeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const home = env["HOME"] ?? env["USERPROFILE"] ?? "";
  return join(home, ".claude", "settings.json");
}
