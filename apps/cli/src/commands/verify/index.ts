import { defineCommand } from "citty";
import { verifyClaimsCommand } from "./claims.js";
import { verifyDisableHookCommand, verifyEnableHookCommand } from "./enable-hook.js";

export const verifyCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Claim-verification gate: join success claims to exec receipts.",
  },
  subCommands: {
    claims: verifyClaimsCommand,
    "enable-hook": verifyEnableHookCommand,
    "disable-hook": verifyDisableHookCommand,
  },
});
