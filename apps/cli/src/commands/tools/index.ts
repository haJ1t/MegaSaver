import { defineCommand } from "citty";
import { toolsAddCommand } from "./add.js";
import { toolsExplainCommand } from "./explain.js";
import { toolsListCommand } from "./list.js";
import { toolsRouteCommand } from "./route.js";

export { type RunToolsAddInput, runToolsAdd, toolsAddCommand } from "./add.js";
export { type RunToolsListInput, runToolsList, toolsListCommand } from "./list.js";
export { type RunToolsRouteInput, runToolsRoute, toolsRouteCommand } from "./route.js";
export { type RunToolsExplainInput, runToolsExplain, toolsExplainCommand } from "./explain.js";

export const toolsCommand = defineCommand({
  meta: {
    name: "tools",
    description: "Register tools and route a task-relevant, danger-gated subset.",
  },
  subCommands: {
    add: toolsAddCommand,
    list: toolsListCommand,
    route: toolsRouteCommand,
    explain: toolsExplainCommand,
  },
});
