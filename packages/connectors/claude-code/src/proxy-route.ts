import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installClaudeCodeHook } from "./hook-settings.js";

export type RouteInspection = "absent" | "exact" | "foreign" | "invalid";
export type EnsureHooksError = "settings_invalid" | "lock_unverifiable" | "write_failed";

// The sole owner of Claude Code's `~/.claude/settings.json` proxy route. Keeps
// agent-specific settings shape out of @megasaver/proxy-control (which receives
// this as an injected adapter). Every mutation is value-guarded and refuses a
// symlinked settings file.
export type ClaudeRouteAdapter = {
  inspect(expectedUrl: string): RouteInspection;
  apply(expectedUrl: string): void;
  removeExpected(expectedUrl: string): void;
  ensureHooks(): { configured: boolean; error?: EnsureHooksError };
};

// ANTHROPIC_BASE_URL is a NAMED field (not an index-signature access) so strict
// noPropertyAccessFromIndexSignature is satisfied without bracket noise.
type Settings = {
  env?: { ANTHROPIC_BASE_URL?: string } & Record<string, string>;
  [k: string]: unknown;
};

function readSettings(path: string): Settings | "absent" | "invalid" {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return "absent";
  }
  if (st.isSymbolicLink() || !st.isFile()) return "invalid";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return "invalid";
    return parsed as Settings;
  } catch {
    return "invalid";
  }
}

function writeSettings(path: string, settings: Settings): void {
  // Refuse to replace a symlink — never follow it out of the settings dir.
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("refusing symlinked settings");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    // ENOENT is fine — creating a fresh file.
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function createClaudeRouteAdapter(settingsPath: string): ClaudeRouteAdapter {
  return {
    inspect(expectedUrl) {
      const s = readSettings(settingsPath);
      if (s === "absent") return "absent";
      if (s === "invalid") return "invalid";
      const current = s.env?.ANTHROPIC_BASE_URL;
      if (current === undefined) return "absent";
      return current === expectedUrl ? "exact" : "foreign";
    },
    apply(expectedUrl) {
      const s = readSettings(settingsPath);
      const settings: Settings = s === "absent" || s === "invalid" ? {} : s;
      settings.env = { ...(settings.env ?? {}), ANTHROPIC_BASE_URL: expectedUrl };
      writeSettings(settingsPath, settings);
    },
    removeExpected(expectedUrl) {
      const s = readSettings(settingsPath);
      if (s === "absent" || s === "invalid") return;
      // Value-guard: only drop the key when it is exactly our owned url.
      if (s.env?.ANTHROPIC_BASE_URL !== expectedUrl) return;
      const { ANTHROPIC_BASE_URL: _drop, ...rest } = s.env;
      s.env = rest;
      writeSettings(settingsPath, s);
    },
    ensureHooks() {
      const s = readSettings(settingsPath);
      if (s === "invalid") return { configured: false, error: "settings_invalid" };
      try {
        installClaudeCodeHook({ settingsPath });
        return { configured: true };
      } catch {
        return { configured: false, error: "write_failed" };
      }
    },
  };
}
