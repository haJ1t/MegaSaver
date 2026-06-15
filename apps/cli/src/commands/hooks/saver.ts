import { defineCommand } from "citty";
import { runSaverHookFromProcess } from "../../hooks/saver-run.js";

// The command Claude Code's PostToolUse hook invokes. Reads the tool result on
// stdin, compresses large native output when Saver Mode is on, and emits an
// updatedToolOutput. SAFETY: ALWAYS exits 0; emits nothing on any error so the
// original output is preserved. Wired by `mega hooks install`, not run by hand.
export const hooksSaverCommand = defineCommand({
  meta: {
    name: "saver",
    description: "Internal: compress a Claude Code PostToolUse tool result (stdin payload).",
  },
  async run() {
    await runSaverHookFromProcess();
  },
});
