import { join } from "node:path";
import { resolveHomeDir } from "../../store.js";

// Production default for the Claude Code user settings.json that carries the
// PreToolUse hook entry. SAFETY: this is the ONLY place the real ~/.claude
// path is named, and only the production CLI wiring resolves it. Every test
// injects a temp settings path instead — nothing here is reachable from a
// test that does not pass `--settings`.
export function resolveClaudeCodeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveHomeDir(env), ".claude", "settings.json");
}
