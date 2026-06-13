import { defineCommand } from "citty";
import { runHookLoggerFromProcess } from "../../hooks/logger-run.js";

// The command Claude Code's PreToolUse hook invokes. Reads the tool-call
// payload from stdin and best-effort appends one metadata line. SAFETY: this
// ALWAYS exits 0 — telemetry must never block the user's tool call. Hidden
// from help by intent (it is wired by `mega hooks install`, not run by hand).
export const hooksLogCommand = defineCommand({
  meta: {
    name: "log",
    description: "Internal: append a Claude Code PreToolUse telemetry record (stdin payload).",
  },
  run() {
    runHookLoggerFromProcess();
  },
});
