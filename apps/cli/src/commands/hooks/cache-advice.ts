import { defineCommand } from "citty";
import { runCacheAdviceHookFromProcess } from "../../hooks/cache-advice-run.js";

export const hooksCacheAdviceCommand = defineCommand({
  meta: {
    name: "cache-advice",
    description: "Internal: advise batched exploration from a PreToolUse stdin payload.",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runCacheAdviceHookFromProcess(typeof args.store === "string" ? args.store : undefined);
  },
});
