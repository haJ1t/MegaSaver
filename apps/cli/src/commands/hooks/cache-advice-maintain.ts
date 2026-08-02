import { defineCommand } from "citty";
import { maintainCacheAdviceStore } from "../../hooks/cache-advice-maintenance.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export const hooksCacheAdviceMaintainCommand = defineCommand({
  meta: {
    name: "cache-advice-maintain",
    description: "Internal: one-shot cache-advice store maintenance.",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    process.exitCode = 0;
    try {
      const storeRoot = resolveStorePath(
        readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      );
      await maintainCacheAdviceStore({ storeRoot, now: Date.now() });
    } catch {
      // Off-hook maintenance must never surface a failure to the operator.
    }
  },
});
