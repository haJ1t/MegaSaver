import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { installClaudeCodeHook, readClaudeCodeHookStatus } from "./hook-settings.js";

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
  // Read-only: reports whether the saver hooks are installed WITHOUT mutating
  // settings — the status/read path must never install anything.
  inspectHooks(): boolean;
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
  // Refuse to replace a symlink — never follow it out of the settings dir. Also
  // capture the existing file's mode so a surgical route edit preserves the
  // operator's chosen permissions instead of silently reverting to a default.
  let existingMode: number | undefined;
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error("refusing symlinked settings");
    existingMode = st.mode & 0o777;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    // ENOENT is fine — creating a fresh file (conservative 0600 below).
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  const mode = existingMode ?? 0o600;
  try {
    // fsync the tmp file AND the directory before/after the rename so a crash
    // mid-write can never leave ~/.claude/settings.json truncated or the rename
    // un-journaled — this is the operator's live agent config.
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode });
    chmodSync(tmp, mode);
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    if (process.platform !== "win32") {
      const dfd = openSync(dir, "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    }
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
      // Never clobber an unparseable file (the matrix only applies on an absent
      // route; an invalid file is not absent, so this is defense in depth).
      if (s === "invalid") return;
      const settings: Settings = s === "absent" ? {} : s;
      const current = settings.env?.ANTHROPIC_BASE_URL;
      // Value-guard (defense in depth): never overwrite a FOREIGN route. The
      // matrix only emits apply on an absent route, but a foreign value slipping
      // into the read→write window must not clobber the operator's own gateway.
      if (current !== undefined && current !== expectedUrl) return;
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
    inspectHooks() {
      return readClaudeCodeHookStatus({ settingsPath }).connected;
    },
  };
}
