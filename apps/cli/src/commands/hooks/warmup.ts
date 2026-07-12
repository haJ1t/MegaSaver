import { defineCommand } from "citty";
import { runWarmupHookFromProcess } from "../../hooks/warmup-run.js";

// The command Claude Code's SessionStart hook invokes. Reads the SessionStart
// payload on stdin and prints the warm-start brief to stdout (Claude Code
// injects stdout into the session context). SAFETY: ALWAYS exits 0; prints
// nothing on any error. Wired by `mega hooks install`, not run by hand.
export const hooksWarmupCommand = defineCommand({
  meta: {
    name: "warmup",
    description: "Internal: print the warm-start brief for a SessionStart hook (stdin payload).",
  },
  async run() {
    await runWarmupHookFromProcess();
  },
});
