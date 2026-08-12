import { defineCommand } from "citty";
import { runMeshHintFromProcess } from "../../hooks/mesh-hint.js";

export const hooksMeshHintCommand = defineCommand({
  meta: {
    name: "mesh-hint",
    description: "Internal: peer Q&A hint UserPromptSubmit hook (stdin payload).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runMeshHintFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
