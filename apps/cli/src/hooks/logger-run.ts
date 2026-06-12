import { readFileSync } from "node:fs";
import { writeHookLine } from "./logger.js";

// Runnable wrapper for the Claude Code PreToolUse hook. The hook fires with
// the tool-call payload on stdin and the project as cwd. SAFETY (§13.4): this
// NEVER throws and ALWAYS returns 0 — the user's tool call must never be
// blocked by telemetry. The megasaver root is the cwd (the hook runs at the
// project root); the log lands in <cwd>/.megasaver/hooks/.
export type RunHookLoggerInput = {
  stdin: string;
  cwd: string;
  now?: () => string;
};

export function runHookLogger(input: RunHookLoggerInput): 0 {
  try {
    const trimmed = input.stdin.trim();
    if (trimmed !== "") {
      const payload: unknown = JSON.parse(trimmed);
      writeHookLine({
        megasaverRoot: input.cwd,
        payload,
        ...(input.now !== undefined ? { now: input.now } : {}),
      });
    }
  } catch {
    // Swallow everything — best-effort telemetry, never block the tool call.
  }
  return 0;
}

function readStdinSync(): string {
  try {
    // fd 0 = stdin. The hook pipes a small JSON payload; a sync read keeps the
    // wrapper dependency-free and fast.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Entry used by the `mega hooks log` subcommand. Reads stdin synchronously,
// runs the logger, and ALWAYS exits 0.
export function runHookLoggerFromProcess(): void {
  const code = runHookLogger({ stdin: readStdinSync(), cwd: process.cwd() });
  process.exitCode = code;
}
