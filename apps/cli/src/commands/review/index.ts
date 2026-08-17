import { defineCommand } from "citty";
import { reviewPackCommand } from "./pack.js";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Review tools for git commit ranges and evidence packs.",
  },
  subCommands: {
    pack: reviewPackCommand,
  },
});
