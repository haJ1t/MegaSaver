// @ts-nocheck
import { defineCommand } from "citty";

export const prVerifyCommand = defineCommand({
  meta: { name: "verify", description: "Verify an evidence bundle (hash-join, no re-exec)." },
  args: {
    bundle: { type: "positional", required: true, description: "Path to bundle.json." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    console.log(`pr verify: ${args.bundle} (stub — hash re-check, see spec)`);
  },
});
