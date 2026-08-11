import { defineCommand } from "citty";
import { sweepQuarantineCommand } from "./quarantine.js";
import { sweepRestoreCommand } from "./restore.js";
import { sweepScanCommand } from "./scan.js";

export const sweepCommand = defineCommand({
  meta: { name: "sweep", description: "Scan and quarantine residue (never delete)." },
  subCommands: {
    scan: sweepScanCommand,
    quarantine: sweepQuarantineCommand,
    restore: sweepRestoreCommand,
  },
});
