import { defineCommand } from "citty";
import { handoffClearCommand } from "./clear.js";
import { handoffInspectCommand } from "./inspect.js";
import { handoffOpenCommand } from "./open.js";
import { handoffPackCommand } from "./pack.js";

export { HANDOFF_UPSELL } from "./shared.js";
export { type RunHandoffPackInput, handoffPackCommand, runHandoffPack } from "./pack.js";
export { type RunHandoffOpenInput, handoffOpenCommand, runHandoffOpen } from "./open.js";
export {
  type RunHandoffInspectInput,
  handoffInspectCommand,
  runHandoffInspect,
} from "./inspect.js";
export { type RunHandoffClearInput, handoffClearCommand, runHandoffClear } from "./clear.js";

// Root run = pack: `mega handoff --to codex` packs; subcommands consume.
// Spread keeps pack's args/run as the SAME references (registration test asserts
// identity) while preserving their optional modifier — a direct `args:
// handoffPackCommand.args` would widen to `| undefined` and fail
// exactOptionalPropertyTypes.
export const handoffCommand = defineCommand({
  ...handoffPackCommand,
  meta: {
    name: "handoff",
    description:
      "Pack the live task into a .megahandoff packet for another agent (Mega Saver Pro).",
  },
  subCommands: {
    open: handoffOpenCommand,
    inspect: handoffInspectCommand,
    clear: handoffClearCommand,
  },
});
