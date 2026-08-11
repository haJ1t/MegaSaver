import { defineCommand } from "citty";
import { prBundleCommand } from "./bundle.js";
import { prVerifyCommand } from "./verify.js";

export const prCommand = defineCommand({
  meta: { name: "pr", description: "Evidence bundle for PRs (hash-verified)." },
  subCommands: {
    bundle: prBundleCommand,
    verify: prVerifyCommand,
  },
});
