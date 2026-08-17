import { defineCommand } from "citty";
import { runRecapHookFromProcess } from "../../hooks/recap-run.js";

// The command Claude Code's SessionStart hook invokes after compaction. Emits
// the work-state recap as additionalContext only for source === "compact".
// SAFETY: ALWAYS exits 0; prints nothing on any error or non-compact source.
export const hooksRecapCommand = defineCommand({
  meta: {
    name: "recap",
    description:
      "Internal: print the post-compact work-state recap for a SessionStart hook (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runRecapHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
