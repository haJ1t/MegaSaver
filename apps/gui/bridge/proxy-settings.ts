import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";

// Claude Code applies its global `~/.claude/settings.json` `env` block to every
// new session it starts (anywhere) — including agents MegaSaver spawns. Writing
// ANTHROPIC_BASE_URL there is how the proxy toggle auto-routes new sessions with
// zero manual `export`. Global (not project) so it works regardless of which
// directory the agent runs in. (An already-running session can't be retargeted —
// env is read at process start.)
interface LocalSettings {
  env?: { ANTHROPIC_BASE_URL?: string };
  [key: string]: unknown;
}

const { MEGA_PROXY_SETTINGS_PATH } = process.env;

export function defaultProxySettingsPath(): string {
  return MEGA_PROXY_SETTINGS_PATH ?? resolveClaudeCodeSettingsPath();
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}

// url → set ANTHROPIC_BASE_URL; null → remove it. Non-destructive: preserves all
// other settings keys, and leaves a corrupt/unreadable file untouched.
export function applyProxyEnv(url: string | null, settingsPath = defaultProxySettingsPath()): void {
  let settings: LocalSettings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as LocalSettings;
  } catch (e) {
    if (!(isErrno(e) && e.code === "ENOENT")) return; // corrupt → don't clobber
  }
  const { ANTHROPIC_BASE_URL: _drop, ...rest } = settings.env ?? {};
  settings.env = url ? { ...rest, ANTHROPIC_BASE_URL: url } : rest;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
