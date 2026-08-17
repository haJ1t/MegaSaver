import { defineCommand } from "citty";
import { runCapsuleHookFromProcess } from "../../hooks/capsule-run.js";

// The command Claude Code's PreCompact hook invokes. Reads the PreCompact
// payload on stdin and snapshots a work-state capsule to the store. SAFETY:
// ALWAYS exits 0; writes no stdout. Wired by `mega hooks install`.
export const hooksCapsuleCommand = defineCommand({
  meta: {
    name: "capsule",
    description: "Internal: snapshot a work-state capsule for a PreCompact hook (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runCapsuleHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
