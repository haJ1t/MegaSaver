import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Wave 1 (spec 2026-07-09): PreToolUse telemetry and the PostToolUse saver
// now cover the same tool surface — agent/search tools plus any MCP tool —
// so the two matchers are unified into one constant. Anchored with ^(?:…)$:
// the `mcp__.*` alternative makes Claude Code compile the string as an
// unanchored RegExp, so without the anchors "TaskCreate"/"ReadMcpResourceTool"
// would match as substrings and fire the hook on ineligible tools.
export const HOOK_MATCHER =
  "^(?:Read|Bash|Grep|Glob|LS|WebFetch|Task|BashOutput|Monitor|WebSearch|ToolSearch|mcp__.*)$";
export const DEFAULT_HOOK_COMMAND = "mega hooks log";
export const SAVER_HOOK_COMMAND = "mega hooks saver";
export const SAVER_HOOK_MATCHER = HOOK_MATCHER;
export const INTENT_HOOK_COMMAND = "mega hooks intent";

type CommandHook = { type: "command"; command: string; timeout?: number };

export type HookCommandConfig = { cliPath?: string; storeRoot?: string };

// E23: hook commands are built from the stable ABSOLUTE launcher path of the
// running CLI (quoted iff it contains whitespace — the hook shell splits on
// spaces) plus, for a non-default store, an E29 `--store` bake. cliPath absent
// keeps the legacy bare "mega" form.
export function buildHookCommand(
  subcommand: "log" | "saver" | "intent",
  cfg: HookCommandConfig = {},
): string {
  const bin = cfg.cliPath === undefined ? "mega" : quoteIfNeeded(cfg.cliPath);
  const store = cfg.storeRoot === undefined ? "" : ` --store "${cfg.storeRoot}"`;
  return `${bin}${store} hooks ${subcommand}`;
}

function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

// One matcher for every historical command form: bare `mega hooks saver`,
// absolute `/abs/mega hooks saver`, store-baked `/abs/mega --store "…" hooks
// saver`. The space-prefixed suffix check excludes accidental substrings
// ("myhooks saver").
export function hookCommandMatches(command: string, subcommand: string): boolean {
  return command === `hooks ${subcommand}` || command.endsWith(` hooks ${subcommand}`);
}

// Every Mega hook command ends with "hooks <subcommand>"; the public add/has/
// remove functions keep their (settings, command) signatures for compat and
// derive the subcommand from the command's last token.
function subcommandOf(command: string): string {
  const parts = command.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function timeoutFor(subcommand: string): number {
  return subcommand === "saver" ? 30 : 10;
}
type ToolUseEntry = { matcher?: string; hooks?: CommandHook[] };
type SettingsObject = {
  hooks?: {
    PreToolUse?: unknown;
    PostToolUse?: unknown;
    UserPromptSubmit?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function asSettings(value: unknown): SettingsObject {
  return typeof value === "object" && value !== null ? { ...(value as SettingsObject) } : {};
}

function entryMatchesSubcommand(entry: unknown, subcommand: string): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as ToolUseEntry).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some((h) => typeof h?.command === "string" && hookCommandMatches(h.command, subcommand))
  );
}

// Rewrites, on every entry that already carries this subcommand, the matcher
// (when given) AND the CommandHook itself to `desired` — this is how a legacy
// bare/absolute/store-baked entry migrates in place on re-install. Never
// mutates the input array or its entries. Returns null when no entry matched,
// so the caller falls through to appending a new one.
function repairEntry(
  entries: ToolUseEntry[],
  subcommand: string,
  matcher: string | undefined,
  desired: CommandHook,
): ToolUseEntry[] | null {
  let found = false;
  const next = entries.map((entry) => {
    if (!entryMatchesSubcommand(entry, subcommand)) return entry;
    found = true;
    const hooks = (entry.hooks ?? []).map((h) =>
      typeof h?.command === "string" && hookCommandMatches(h.command, subcommand)
        ? { ...desired }
        : h,
    );
    const repaired: ToolUseEntry = { ...entry, hooks };
    if (matcher !== undefined) repaired.matcher = matcher;
    return repaired;
  });
  return found ? next : null;
}

export function hasPreToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addPreToolUseHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(existingPre as ToolUseEntry[], sub, HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function hasPostToolUseHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const post = (settings as SettingsObject).hooks?.PostToolUse;
  return Array.isArray(post) && post.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addPostToolUseHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPost = next.hooks?.PostToolUse;
  if (Array.isArray(existingPost)) {
    const repaired = repairEntry(existingPost as ToolUseEntry[], sub, SAVER_HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PostToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const post = Array.isArray(existingPost) ? [...(existingPost as ToolUseEntry[])] : [];
  post.push({ matcher: SAVER_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PostToolUse: post };
  return next;
}

// Returns `next` with the kept entries written back under `key`, dropping that
// hooks-array key when empty and the whole `hooks` key when no entries remain —
// so a clean uninstall leaves no residue.
function pruneHooks(
  next: SettingsObject,
  key: "PreToolUse" | "PostToolUse" | "UserPromptSubmit",
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
function stripCommand(entries: ToolUseEntry[], subcommand: string): ToolUseEntry[] {
  const kept: ToolUseEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter(
      (h) => !(typeof h?.command === "string" && hookCommandMatches(h.command, subcommand)),
    );
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
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreToolUse", kept);
}

export function removePostToolUseHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PostToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PostToolUse", kept);
}

export function hasUserPromptSubmitHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const ups = (settings as SettingsObject).hooks?.UserPromptSubmit;
  return Array.isArray(ups) && ups.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addUserPromptSubmitHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingUps = next.hooks?.UserPromptSubmit;
  if (Array.isArray(existingUps)) {
    const repaired = repairEntry(existingUps as ToolUseEntry[], sub, undefined, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, UserPromptSubmit: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const ups = Array.isArray(existingUps) ? [...(existingUps as ToolUseEntry[])] : [];
  // ponytail: no matcher for UserPromptSubmit — Claude Code ignores the field for this event type
  ups.push({ hooks: [desired] });
  next.hooks = { ...hooks, UserPromptSubmit: ups };
  return next;
}

export function removeUserPromptSubmitHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.UserPromptSubmit;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "UserPromptSubmit", kept);
}

export type InstallClaudeCodeHookInput = {
  settingsPath: string;
  command?: string;
  config?: HookCommandConfig;
};
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
  const cfg = input.config ?? {};
  const command = input.command ?? buildHookCommand("log", cfg);
  const existing = readSettings(input.settingsPath);
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, buildHookCommand("saver", cfg));
  next = addUserPromptSubmitHook(next, buildHookCommand("intent", cfg));
  // Presence alone isn't enough to no-op: a matcher can drift (wave-1 tool
  // additions) while the command entry stays present. Diff by value so a
  // drifted matcher is repaired in place and reported as changed.
  if (JSON.stringify(next) === JSON.stringify(existing)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  writeSettings(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}

export function uninstallClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  if (!existsSync(input.settingsPath)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  const existing = readSettings(input.settingsPath);
  if (
    !hasPreToolUseHook(existing, command) &&
    !hasPostToolUseHook(existing, SAVER_HOOK_COMMAND) &&
    !hasUserPromptSubmitHook(existing, INTENT_HOOK_COMMAND)
  ) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = removePreToolUseHook(existing, command);
  next = removePostToolUseHook(next, SAVER_HOOK_COMMAND);
  next = removeUserPromptSubmitHook(next, INTENT_HOOK_COMMAND);
  writeSettings(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}

export type ClaudeCodeHookStatus = {
  connected: boolean;
  preInstalled: boolean;
  postInstalled: boolean;
  intentInstalled: boolean;
};

export function readClaudeCodeHookStatus(input: InstallClaudeCodeHookInput): ClaudeCodeHookStatus {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  let settings: unknown;
  try {
    settings = readSettings(input.settingsPath);
  } catch {
    return { connected: false, preInstalled: false, postInstalled: false, intentInstalled: false };
  }
  const preInstalled = hasPreToolUseHook(settings, command);
  const postInstalled = hasPostToolUseHook(settings, SAVER_HOOK_COMMAND);
  const intentInstalled = hasUserPromptSubmitHook(settings, INTENT_HOOK_COMMAND);
  return {
    connected: preInstalled && postInstalled && intentInstalled,
    preInstalled,
    postInstalled,
    intentInstalled,
  };
}

// Mirrors apps/cli/src/store.ts resolveHomeDir exactly: Windows has no HOME →
// fall back to USERPROFILE, then "" (NOT os.homedir()). SAFETY: the only place
// the real ~/.claude path is named; every test injects a temp settings path.
export function resolveClaudeCodeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const home = env["HOME"] ?? env["USERPROFILE"] ?? "";
  return join(home, ".claude", "settings.json");
}
