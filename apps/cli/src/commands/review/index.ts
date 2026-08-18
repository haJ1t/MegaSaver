import { defineCommand } from "citty";
import { reviewAttestCommand } from "./attest.js";
import { reviewCheckCommand } from "./check.js";
import { reviewPackCommand } from "./pack.js";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Review tools for git commit ranges, attestations, and evidence packs.",
  },
  subCommands: {
    attest: reviewAttestCommand,
    check: reviewCheckCommand,
    pack: reviewPackCommand,
  },
});
