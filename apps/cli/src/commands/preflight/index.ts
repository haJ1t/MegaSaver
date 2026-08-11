import { defineCommand } from "citty";
import { preflightDiffCommand } from "./diff.js";
import { preflightSnapshotCommand } from "./snapshot.js";

export const preflightCommand = defineCommand({
  meta: { name: "preflight", description: "Workspace preflight snapshot + diff." },
  subCommands: {
    snapshot: preflightSnapshotCommand,
    diff: preflightDiffCommand,
  },
});
