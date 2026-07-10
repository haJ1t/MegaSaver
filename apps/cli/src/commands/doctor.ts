import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_HOOK_COMMAND, hasPreToolUseHook } from "@megasaver/connector-claude-code";
import { defineCommand } from "citty";
import { HOOK_LOG_RELATIVE_PATH } from "../hooks/logger.js";
import { runSaverChecks } from "./doctor-saver.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";

export type Check = {
  key: string;
  value: string;
  pass: boolean;
  reason?: string;
};

export function checkNode(version: string = process.versions.node): Check {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  const value = `v${version}`;
  if (major >= 22) {
    return { key: "node", value, pass: true };
  }
  return { key: "node", value, pass: false, reason: "need ≥22" };
}

export function checkPlatform(platform: NodeJS.Platform = process.platform): Check {
  return { key: "platform", value: platform, pass: true };
}

export function checkCwd(cwd: string = process.cwd()): Check {
  return { key: "cwd", value: cwd, pass: true };
}

export type HookTelemetryPaths = {
  settingsPath: string;
  hookLogPath: string;
  command?: string;
};

// Proxy Mode v1.2 §13.7 — detect Claude Code hook telemetry. Installed when
// EITHER the settings.json carries the PreToolUse entry OR a hook log already
// exists (telemetry is flowing). SAFETY: paths are injected; the production
// wiring resolves the real Claude Code locations, but tests pass temp paths so
// the real ~/.claude is never read. Malformed settings -> treated as missing,
// never throws.
export function checkHookTelemetry(paths: HookTelemetryPaths): Check {
  const command = paths.command ?? DEFAULT_HOOK_COMMAND;
  const settingsInstalled = ((): boolean => {
    if (!existsSync(paths.settingsPath)) return false;
    try {
      return hasPreToolUseHook(JSON.parse(readFileSync(paths.settingsPath, "utf8")), command);
    } catch {
      return false;
    }
  })();
  const logPresent = existsSync(paths.hookLogPath);
  if (settingsInstalled || logPresent) {
    return { key: "claude-code-hook-telemetry", value: "installed", pass: true };
  }
  return {
    key: "claude-code-hook-telemetry",
    value: "missing",
    pass: false,
    reason: "run: mega hooks install claude-code",
  };
}

function defaultHookTelemetryPaths(): HookTelemetryPaths {
  return {
    settingsPath: resolveClaudeCodeSettingsPath(),
    hookLogPath: join(process.cwd(), HOOK_LOG_RELATIVE_PATH),
  };
}

export function runChecks(): Check[] {
  return [checkNode(), checkPlatform(), checkCwd()];
}

export function renderReport(checks: Check[]): string {
  const lines = checks.map((c) => {
    const status = c.pass ? "PASS" : "FAIL";
    const reason = c.reason ? ` (${c.reason})` : "";
    return `${c.key} ${c.value} ${status}${reason}`;
  });
  const passCount = checks.filter((c) => c.pass).length;
  const failCount = checks.length - passCount;
  return `${lines.join("\n")}\n\n${passCount} PASS / ${failCount} FAIL`;
}

export function exitCodeFor(checks: Check[]): 0 | 1 {
  return checks.some((c) => !c.pass) ? 1 : 0;
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Environment diagnostics.",
  },
  args: {},
  run() {
    // E22: environment checks + the saver verifier (registration, binary,
    // store bake, liveness, self-test, daemon). Saver FAILs affect the exit
    // code through the same exitCodeFor; warnings are pass:true with a reason.
    const checks = [...runChecks(), ...runSaverChecks()];
    // Hook telemetry is informational: a "missing" result reports the install
    // hint but never fails the doctor (it is opt-in, not an environment fault),
    // so it is rendered below the env summary and excluded from exitCodeFor.
    const hookCheck = checkHookTelemetry(defaultHookTelemetryPaths());
    const hookLine =
      hookCheck.value === "installed"
        ? "\n\nClaude Code hook telemetry: installed"
        : `\n\nClaude Code hook telemetry: missing (${hookCheck.reason})`;
    console.log(`${renderReport(checks)}${hookLine}`);
    const code = exitCodeFor(checks);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
});
