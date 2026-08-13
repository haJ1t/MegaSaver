import { defineCommand } from "citty";
import { runExecRewriteHookFromProcess } from "../../hooks/exec-rewrite-run.js";

// The command Claude Code's exec-rewrite PreToolUse hook invokes for Bash.
// Reads the PreToolUse payload on stdin; prints a hookSpecificOutput JSON
// (updatedInput only — never permissionDecision) when an eligible
// flat-token command is rewritten to `mega output exec-live`.
// SAFETY: ALWAYS exits 0; prints nothing on any error. Wired by
// `mega hooks install --exec-rewrite`, not run by hand.
export const hooksExecRewriteCommand = defineCommand({
  meta: {
    name: "exec-rewrite",
    description: "Internal: exec-rewrite PreToolUse interceptor (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    runExecRewriteHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
