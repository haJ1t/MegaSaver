import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeSettingsFile } from "./settings-write.js";

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
export const WARMUP_HOOK_COMMAND = "mega hooks warmup";
export const CAPSULE_HOOK_COMMAND = "mega hooks capsule";
export const RECAP_HOOK_COMMAND = "mega hooks recap";
export const GUARD_HOOK_COMMAND = "mega hooks guard";
export const CACHE_ADVICE_HOOK_COMMAND = "mega hooks cache-advice";
export const MESH_HINT_HOOK_COMMAND = "mega hooks mesh-hint";
export const CACHE_ADVICE_HOOK_MATCHER = "^(?:Read|Grep|Glob|Bash)$";
// Guard runs ONLY on mutating tools — never Read/Grep/etc. Anchored for the
// same substring-compile reason as HOOK_MATCHER.
export const GUARD_HOOK_MATCHER = "^(?:Bash|Edit|Write|MultiEdit|NotebookEdit)$";
// Exec-rewrite is a command-REWRITING behavior (LD1): its own auditable,
// independently-removable entry, never piggybacked on guard. ^Bash$ only —
// Read/Grep/Glob stay on the PostToolUse path.
export const EXEC_REWRITE_HOOK_COMMAND = "mega hooks exec-rewrite";
export const EXEC_REWRITE_HOOK_MATCHER = "^Bash$";
export const VERIFY_REMINDER_HOOK_COMMAND = "mega hooks verify-reminder";

type CommandHook = { type: "command"; command: string; timeout?: number };

export type HookCommandConfig = { cliPath?: string; storeRoot?: string };

// E23: hook commands are built from the stable ABSOLUTE launcher path of the
// running CLI (quoted iff it contains whitespace — the hook shell splits on
// spaces) plus, for a non-default store, an E29 `--store` bake after the
// subcommand where Citty parses it. cliPath absent keeps the legacy bare
// "mega" form.
export function buildHookCommand(
  subcommand:
    | "log"
    | "saver"
    | "intent"
    | "warmup"
    | "capsule"
    | "recap"
    | "guard"
    | "cache-advice"
    | "mesh-hint"
    | "exec-rewrite"
    | "verify-reminder"
    | "failure-scan",
  cfg: HookCommandConfig = {},
): string {
  const bin = cfg.cliPath === undefined ? "mega" : quoteForPosixShell(cfg.cliPath);
  const store =
    cfg.storeRoot === undefined || subcommand === "log"
      ? ""
      : ` --store ${quoteForPosixShell(cfg.storeRoot)}`;
  return `${bin} hooks ${subcommand}${store}`;
}

function quoteForPosixShell(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

type HookCommandToken = { value: string; quoted: boolean };

const SAFE_UNQUOTED_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;
const SAFE_LEGACY_DOUBLE_QUOTED_TOKEN = /^[A-Za-z0-9_ ./:@%+=,\\-]+$/;

function tokenizeHookCommand(command: string): HookCommandToken[] | null {
  const tokens: HookCommandToken[] = [];
  let cursor = 0;
  while (cursor < command.length) {
    if (command[cursor] === " ") return null;
    let value = "";
    let quoted = false;
    while (cursor < command.length && command[cursor] !== " ") {
      const current = command[cursor];
      if (current === "'") {
        quoted = true;
        cursor += 1;
        const start = cursor;
        while (cursor < command.length && command[cursor] !== "'") cursor += 1;
        if (cursor === command.length) return null;
        value += command.slice(start, cursor);
        cursor += 1;
        continue;
      }
      if (current === '"') {
        quoted = true;
        cursor += 1;
        const start = cursor;
        while (cursor < command.length && command[cursor] !== '"') cursor += 1;
        if (cursor === command.length) return null;
        const segment = command.slice(start, cursor);
        if (segment !== "'" && !SAFE_LEGACY_DOUBLE_QUOTED_TOKEN.test(segment)) return null;
        value += segment;
        cursor += 1;
        continue;
      }
      if (
        !SAFE_UNQUOTED_TOKEN.test(current ?? "") &&
        !(process.platform === "win32" && current === "\\")
      ) {
        return null;
      }
      value += current;
      cursor += 1;
    }
    if (value === "") return null;
    tokens.push({ value, quoted });
    if (cursor === command.length) break;
    cursor += 1;
    if (cursor === command.length || command[cursor] === " ") return null;
  }
  return tokens;
}

function isPathSeparator(value: string): boolean {
  return value === "/" || value === "\\";
}

function isAbsoluteLauncherPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path[0] === "/") return true;
  return isWindowsAbsoluteLauncherPath(path);
}

function isWindowsAbsoluteLauncherPath(path: string): boolean {
  if (path.startsWith("\\\\")) {
    const segments = launcherPathSegments(path, true);
    return (segments[2] ?? "") !== "" && (segments[3] ?? "") !== "" && (segments[4] ?? "") !== "";
  }
  const drive = path.charCodeAt(0);
  const isDriveLetter = (drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122);
  return isDriveLetter && path[1] === ":" && isPathSeparator(path[2] ?? "");
}

function launcherPathSegments(path: string, windowsPath: boolean): string[] {
  const segments: string[] = [];
  let start = 0;
  for (let cursor = 0; cursor <= path.length; cursor += 1) {
    if (cursor === path.length || path[cursor] === "/" || (windowsPath && path[cursor] === "\\")) {
      segments.push(path.slice(start, cursor));
      start = cursor + 1;
    }
  }
  return segments;
}

function isFirstPartyLauncher(token: HookCommandToken | undefined): boolean {
  if (token === undefined) return false;
  if (!token.quoted && token.value === "mega") return true;
  if (!isAbsoluteLauncherPath(token.value)) return false;
  const windowsPath = isWindowsAbsoluteLauncherPath(token.value);
  const caseInsensitive = process.platform === "win32" && windowsPath;
  const comparable = (value: string | undefined): string | undefined =>
    caseInsensitive ? value?.toLowerCase() : value;
  const segments = launcherPathSegments(token.value, windowsPath).map(
    (segment) => comparable(segment) ?? "",
  );
  const executable = segments.at(-1);
  if (executable === "mega" || executable === "mega.mjs") {
    return true;
  }
  if (executable === "mega.cmd" || executable === "mega.exe") return windowsPath;
  if (executable !== "cli.js" || segments.length < 4) return false;
  const packageName = segments.at(-4);
  return (
    (packageName === "apps" || packageName === "@megasaver") &&
    segments.at(-3) === "cli" &&
    segments.at(-2) === "dist"
  );
}

function tokenIs(token: HookCommandToken | undefined, value: string): boolean {
  return token?.quoted === false && token.value === value;
}

function consumeOptionalStore(tokens: HookCommandToken[], cursor: number): number | null {
  if (!tokenIs(tokens[cursor], "--store")) return cursor;
  return tokens[cursor + 1] === undefined ? null : cursor + 2;
}

function ownedHookCommandSubcommand(command: string): string | undefined {
  const tokens = tokenizeHookCommand(command);
  if (tokens === null || !isFirstPartyLauncher(tokens[0])) return undefined;
  const hooksCursor = consumeOptionalStore(tokens, 1);
  if (
    hooksCursor === null ||
    !tokenIs(tokens[hooksCursor], "hooks") ||
    tokens[hooksCursor + 1]?.quoted === true
  ) {
    return undefined;
  }
  const end = consumeOptionalStore(tokens, hooksCursor + 2);
  if (end !== tokens.length || (hooksCursor !== 1 && end !== hooksCursor + 2)) return undefined;
  return tokens[hooksCursor + 1]?.value;
}

// Match only Mega Saver's generated launchers and exact hook-command grammar.
// The scanner is linear so foreign paths cannot trigger regex backtracking.
export function hookCommandMatches(command: string, subcommand: string): boolean {
  return ownedHookCommandSubcommand(command) === subcommand;
}

// The public add/has/remove functions keep their (settings, command)
// signatures and derive the subcommand from its `hooks <subcommand>` segment.
// A baked store follows that segment, so it cannot be inferred from the last
// token.
function subcommandOf(command: string): string {
  return ownedHookCommandSubcommand(command) ?? "";
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
    SessionStart?: unknown;
    Stop?: unknown;
    PreCompact?: unknown;
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

// Keeps one owned command while repairing legacy duplicates left by older
// installers. A co-located foreign hook keeps its entry metadata and matcher,
// so the owned command moves to a separate entry instead of adopting it.
function repairEntry(
  entries: ToolUseEntry[],
  subcommand: string,
  matcher: string | undefined,
  desired: CommandHook,
): ToolUseEntry[] | null {
  let found = false;
  let keptOwnedCommand = false;
  const next: ToolUseEntry[] = [];
  for (const entry of entries) {
    if (!entryMatchesSubcommand(entry, subcommand)) {
      next.push(entry);
      continue;
    }

    const foreignHooks = (entry.hooks ?? []).filter(
      (hook) => typeof hook?.command !== "string" || !hookCommandMatches(hook.command, subcommand),
    );
    found = true;
    if (!keptOwnedCommand) {
      if (foreignHooks.length === 0) {
        const repaired: ToolUseEntry = { ...entry, hooks: [{ ...desired }] };
        if (matcher !== undefined) repaired.matcher = matcher;
        next.push(repaired);
      } else {
        const ownedEntry: ToolUseEntry = { hooks: [{ ...desired }] };
        if (matcher !== undefined) ownedEntry.matcher = matcher;
        next.push(ownedEntry, { ...entry, hooks: foreignHooks });
      }
      keptOwnedCommand = true;
    } else if (foreignHooks.length > 0) {
      next.push({ ...entry, hooks: foreignHooks });
    }
  }
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
  key: "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "Stop" | "PreCompact",
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

export function hasSessionStartHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const start = (settings as SettingsObject).hooks?.SessionStart;
  return (
    Array.isArray(start) && start.some((e) => entryMatchesSubcommand(e, subcommandOf(command)))
  );
}

export function addSessionStartHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingStart = next.hooks?.SessionStart;
  if (Array.isArray(existingStart)) {
    const repaired = repairEntry(existingStart as ToolUseEntry[], sub, undefined, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, SessionStart: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const start = Array.isArray(existingStart) ? [...(existingStart as ToolUseEntry[])] : [];
  // ponytail: no matcher for SessionStart — Claude Code ignores the field for this event type
  start.push({ hooks: [desired] });
  next.hooks = { ...hooks, SessionStart: start };
  return next;
}

export function removeSessionStartHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.SessionStart;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "SessionStart", kept);
}

export function hasPreCompactHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreCompact;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addPreCompactHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreCompact;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(existingPre as ToolUseEntry[], sub, undefined, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreCompact: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  // No matcher: PreCompact matchers filter on the trigger value; omitted = both "auto" and "manual".
  pre.push({ hooks: [desired] });
  next.hooks = { ...hooks, PreCompact: pre };
  return next;
}

export function removePreCompactHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreCompact;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreCompact", kept);
}

// C3 claim-verification gate: an opt-in, warn-only receipt reminder on Stop.
// Like SessionStart, Stop takes NO matcher (Claude Code ignores it there).
export function hasStopHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const stop = (settings as SettingsObject).hooks?.Stop;
  return Array.isArray(stop) && stop.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addStopHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingStop = next.hooks?.Stop;
  if (Array.isArray(existingStop)) {
    const repaired = repairEntry(existingStop as ToolUseEntry[], sub, undefined, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, Stop: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const stop = Array.isArray(existingStop) ? [...(existingStop as ToolUseEntry[])] : [];
  stop.push({ hooks: [desired] });
  next.hooks = { ...hooks, Stop: stop };
  return next;
}

export function removeStopHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.Stop;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "Stop", kept);
}

// Guard is a SECOND PreToolUse entry alongside the log entry. addPreToolUseHook
// hardcodes HOOK_MATCHER, so guard needs its own adder with GUARD_HOOK_MATCHER.
// entryMatchesSubcommand/repairEntry key on the subcommand ("guard" vs "log"),
// so the two PreToolUse entries never collide.
export function hasGuardHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addGuardHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(existingPre as ToolUseEntry[], sub, GUARD_HOOK_MATCHER, desired);
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: GUARD_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function removeGuardHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreToolUse", kept);
}

export function hasCacheAdviceHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addCacheAdviceHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(
      existingPre as ToolUseEntry[],
      sub,
      CACHE_ADVICE_HOOK_MATCHER,
      desired,
    );
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: CACHE_ADVICE_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function removeCacheAdviceHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreToolUse", kept);
}

export function hasExecRewriteHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const pre = (settings as SettingsObject).hooks?.PreToolUse;
  return Array.isArray(pre) && pre.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addExecRewriteHook(settings: unknown, command: string): SettingsObject {
  const sub = subcommandOf(command);
  const desired: CommandHook = { type: "command", command, timeout: timeoutFor(sub) };
  const next = asSettings(settings);
  const existingPre = next.hooks?.PreToolUse;
  if (Array.isArray(existingPre)) {
    const repaired = repairEntry(
      existingPre as ToolUseEntry[],
      sub,
      EXEC_REWRITE_HOOK_MATCHER,
      desired,
    );
    if (repaired !== null) {
      next.hooks = { ...next.hooks, PreToolUse: repaired };
      return next;
    }
  }
  const hooks = next.hooks ? { ...next.hooks } : {};
  const pre = Array.isArray(existingPre) ? [...(existingPre as ToolUseEntry[])] : [];
  pre.push({ matcher: EXEC_REWRITE_HOOK_MATCHER, hooks: [desired] });
  next.hooks = { ...hooks, PreToolUse: pre };
  return next;
}

export function removeExecRewriteHook(settings: unknown, command: string): SettingsObject {
  const next = asSettings(settings);
  const existing = next.hooks?.PreToolUse;
  if (!Array.isArray(existing)) return next;
  const kept = stripCommand(existing as ToolUseEntry[], subcommandOf(command));
  return pruneHooks(next, "PreToolUse", kept);
}

export function hasMeshHintHook(settings: unknown, command: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const ups = (settings as SettingsObject).hooks?.UserPromptSubmit;
  return Array.isArray(ups) && ups.some((e) => entryMatchesSubcommand(e, subcommandOf(command)));
}

export function addMeshHintHook(settings: unknown, command: string): SettingsObject {
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
  ups.push({ hooks: [desired] });
  next.hooks = { ...hooks, UserPromptSubmit: ups };
  return next;
}

export function removeMeshHintHook(settings: unknown, command: string): SettingsObject {
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
  warmup?: boolean;
  guard?: boolean;
  cacheAdvice?: boolean;
  meshHint?: boolean;
  execRewrite?: boolean;
  compactionGuard?: boolean;
  platform?: NodeJS.Platform;
};
export type ClaudeCodeHookResult = { settingsPath: string; changed: boolean };

function readSettings(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

function desiredHookSettings(existing: unknown, input: InstallClaudeCodeHookInput): SettingsObject {
  const cfg = input.config ?? {};
  const command = input.command ?? buildHookCommand("log", cfg);
  let next = addPreToolUseHook(existing, command);
  next = addPostToolUseHook(next, buildHookCommand("saver", cfg));
  next = addUserPromptSubmitHook(next, buildHookCommand("intent", cfg));
  if (input.warmup !== false) {
    next = addSessionStartHook(next, buildHookCommand("warmup", cfg));
  }
  if (input.guard !== false) {
    next = addGuardHook(next, buildHookCommand("guard", cfg));
  }
  if (input.compactionGuard !== false) {
    next = addPreCompactHook(next, buildHookCommand("capsule", cfg));
    next = addSessionStartHook(next, buildHookCommand("recap", cfg));
  }
  const cacheAdviceCommand = buildHookCommand("cache-advice", cfg);
  next =
    (input.platform ?? process.platform) === "win32" || input.cacheAdvice === false
      ? removeCacheAdviceHook(next, cacheAdviceCommand)
      : addCacheAdviceHook(next, cacheAdviceCommand);
  const meshHintCommand = buildHookCommand("mesh-hint", cfg);
  next =
    input.meshHint === true
      ? addMeshHintHook(next, meshHintCommand)
      : removeMeshHintHook(next, meshHintCommand);
  const execRewriteCommand = buildHookCommand("exec-rewrite", cfg);
  if (input.execRewrite === true) {
    next = addExecRewriteHook(next, execRewriteCommand);
  } else if (input.execRewrite === false) {
    next = removeExecRewriteHook(next, execRewriteCommand);
  }
  return next;
}

// Same value-diff as installClaudeCodeHook (drift repair precedent above),
// but a pure read: `mega up` prints install/repair/ok BEFORE any write.
export function planClaudeCodeHookInstall(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const existing = readSettings(input.settingsPath);
  const next = desiredHookSettings(existing, input);
  return {
    settingsPath: input.settingsPath,
    changed: JSON.stringify(next) !== JSON.stringify(existing),
  };
}

export function installClaudeCodeHook(input: InstallClaudeCodeHookInput): ClaudeCodeHookResult {
  const existing = readSettings(input.settingsPath);
  const next = desiredHookSettings(existing, input);
  // Presence alone isn't enough to no-op: a matcher can drift (wave-1 tool
  // additions) while the command entry stays present. Diff by value so a
  // drifted matcher is repaired in place and reported as changed.
  if (JSON.stringify(next) === JSON.stringify(existing)) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  writeSettingsFile(input.settingsPath, next);
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
    !hasUserPromptSubmitHook(existing, INTENT_HOOK_COMMAND) &&
    !hasSessionStartHook(existing, WARMUP_HOOK_COMMAND) &&
    !hasSessionStartHook(existing, RECAP_HOOK_COMMAND) &&
    !hasPreCompactHook(existing, CAPSULE_HOOK_COMMAND) &&
    !hasGuardHook(existing, GUARD_HOOK_COMMAND) &&
    !hasCacheAdviceHook(existing, CACHE_ADVICE_HOOK_COMMAND) &&
    !hasMeshHintHook(existing, MESH_HINT_HOOK_COMMAND) &&
    !hasExecRewriteHook(existing, EXEC_REWRITE_HOOK_COMMAND) &&
    !hasStopHook(existing, VERIFY_REMINDER_HOOK_COMMAND)
  ) {
    return { settingsPath: input.settingsPath, changed: false };
  }
  let next = removePreToolUseHook(existing, command);
  next = removePostToolUseHook(next, SAVER_HOOK_COMMAND);
  next = removeUserPromptSubmitHook(next, INTENT_HOOK_COMMAND);
  next = removeSessionStartHook(next, WARMUP_HOOK_COMMAND);
  next = removeSessionStartHook(next, RECAP_HOOK_COMMAND);
  next = removePreCompactHook(next, CAPSULE_HOOK_COMMAND);
  next = removeGuardHook(next, GUARD_HOOK_COMMAND);
  next = removeCacheAdviceHook(next, CACHE_ADVICE_HOOK_COMMAND);
  next = removeMeshHintHook(next, MESH_HINT_HOOK_COMMAND);
  next = removeExecRewriteHook(next, EXEC_REWRITE_HOOK_COMMAND);
  // The Stop reminder is opt-IN (mega verify enable-hook), but full uninstall
  // is the operator's "remove everything" — the reminder goes with the rest.
  next = removeStopHook(next, VERIFY_REMINDER_HOOK_COMMAND);
  writeSettingsFile(input.settingsPath, next);
  return { settingsPath: input.settingsPath, changed: true };
}

export type ClaudeCodeHookStatus = {
  connected: boolean;
  preInstalled: boolean;
  postInstalled: boolean;
  intentInstalled: boolean;
  warmupInstalled: boolean;
  capsuleInstalled: boolean;
  recapInstalled: boolean;
  guardInstalled: boolean;
  cacheAdviceInstalled: boolean;
  meshHintInstalled: boolean;
  execRewriteInstalled: boolean;
  stopInstalled: boolean;
};

export function readClaudeCodeHookStatus(input: InstallClaudeCodeHookInput): ClaudeCodeHookStatus {
  const command = input.command ?? DEFAULT_HOOK_COMMAND;
  let settings: unknown;
  try {
    settings = readSettings(input.settingsPath);
  } catch {
    return {
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
    };
  }
  const preInstalled = hasPreToolUseHook(settings, command);
  const postInstalled = hasPostToolUseHook(settings, SAVER_HOOK_COMMAND);
  const intentInstalled = hasUserPromptSubmitHook(settings, INTENT_HOOK_COMMAND);
  const warmupInstalled = hasSessionStartHook(settings, WARMUP_HOOK_COMMAND);
  const capsuleInstalled = hasPreCompactHook(settings, CAPSULE_HOOK_COMMAND);
  const recapInstalled = hasSessionStartHook(settings, RECAP_HOOK_COMMAND);
  const guardInstalled = hasGuardHook(settings, GUARD_HOOK_COMMAND);
  const cacheAdviceInstalled = hasCacheAdviceHook(settings, CACHE_ADVICE_HOOK_COMMAND);
  const meshHintInstalled = hasMeshHintHook(settings, MESH_HINT_HOOK_COMMAND);
  const execRewriteInstalled = hasExecRewriteHook(settings, EXEC_REWRITE_HOOK_COMMAND);
  const stopInstalled = hasStopHook(settings, VERIFY_REMINDER_HOOK_COMMAND);
  return {
    connected: preInstalled && postInstalled && intentInstalled,
    preInstalled,
    postInstalled,
    intentInstalled,
    warmupInstalled,
    capsuleInstalled,
    recapInstalled,
    guardInstalled,
    cacheAdviceInstalled,
    meshHintInstalled,
    execRewriteInstalled,
    stopInstalled,
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
