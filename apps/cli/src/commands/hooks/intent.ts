import { defineCommand } from "citty";
import { runIntentHookFromProcess } from "../../hooks/intent-run.js";

// The command Claude Code's UserPromptSubmit hook invokes. Reads the prompt
// payload on stdin and records it as the session intent for ranking. SAFETY:
// ALWAYS exits 0; writes nothing on any error. Wired by `mega hooks install`.
export const hooksIntentCommand = defineCommand({
  meta: {
    name: "intent",
    description: "Internal: record the latest Claude Code prompt as ranking intent (stdin payload).",
  },
  run() {
    runIntentHookFromProcess();
  },
});
