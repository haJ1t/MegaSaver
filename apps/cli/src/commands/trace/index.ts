import { defineCommand } from "citty";
import { traceExplainCommand } from "./explain.js";

export {
  type RunTraceExplainInput,
  runTraceExplain,
  renderDecisionTrace,
  traceExplainCommand,
} from "./explain.js";

export const traceCommand = defineCommand({
  meta: {
    name: "trace",
    description: "Decision-trace viewer: explain a session's recorded causal chain.",
  },
  subCommands: {
    explain: traceExplainCommand,
  },
});
