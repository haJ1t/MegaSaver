import { defineCommand } from "citty";
import { handoffClearCommand } from "./clear.js";
import { handoffInspectCommand } from "./inspect.js";
import { handoffOfferCommand } from "./offer.js";
import { handoffOpenCommand } from "./open.js";
import { handoffPackCommand } from "./pack.js";
import { handoffPeersCommand } from "./peers.js";

export { HANDOFF_UPSELL } from "./shared.js";
export {
  handoffFitVerdictLine,
  handoffFieldsFromPacket,
  handoffGitLine,
} from "./shared.js";
export { type RunHandoffPackInput, handoffPackCommand, runHandoffPack } from "./pack.js";
export { type RunHandoffOpenInput, handoffOpenCommand, runHandoffOpen } from "./open.js";
export {
  type RunHandoffInspectInput,
  handoffInspectCommand,
  runHandoffInspect,
} from "./inspect.js";
export { type RunHandoffClearInput, handoffClearCommand, runHandoffClear } from "./clear.js";
export {
  type HandoffPeer,
  type RunHandoffPeersInput,
  handoffPeersCommand,
  runHandoffPeers,
} from "./peers.js";
export {
  type HandoffOfferPointer,
  type RunHandoffOfferInput,
  type SendHandoffOffer,
  handoffOfferCommand,
  runHandoffOffer,
} from "./offer.js";

// Subcommands-only, like every other command family here (office, project, …).
// citty 0.1.6 cannot combine a root `run` + required root `args` (--to) with
// `subCommands`: the required flag shadows subcommand dispatch, so
// `handoff open <file>` fails "Missing required argument: --to" and
// `handoff pack --to codex` fails "Unknown command codex".
export const handoffCommand = defineCommand({
  meta: {
    name: "handoff",
    description:
      "Pack, open, inspect, or clear .megahandoff packets between agents (Mega Saver Pro).",
  },
  subCommands: {
    pack: handoffPackCommand,
    open: handoffOpenCommand,
    inspect: handoffInspectCommand,
    clear: handoffClearCommand,
    peers: handoffPeersCommand,
    offer: handoffOfferCommand,
  },
});
