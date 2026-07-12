import { defineCommand } from "citty";
import { runGuardHookFromProcess } from "../../hooks/guard-run.js";

// The command Claude Code's PreToolUse hook invokes for Bash/edit tools.
// Reads the PreToolUse payload on stdin; prints a hookSpecificOutput JSON
// (warn additionalContext or strict-mode deny) when a stored failure matches.
// SAFETY: ALWAYS exits 0; prints nothing on any error. Wired by
// `mega hooks install`, not run by hand.
export const hooksGuardCommand = defineCommand({
  meta: {
    name: "guard",
    description: "Internal: Mistake Firewall PreToolUse interceptor (stdin payload).",
  },
  async run() {
    await runGuardHookFromProcess();
  },
});
