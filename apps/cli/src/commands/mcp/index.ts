import { defineCommand } from "citty";
import { mcpInstallCommand } from "./install.js";
import { mcpRepairCommand } from "./repair.js";
import { mcpServeCommand } from "./serve.js";
import { mcpStatusCommand } from "./status.js";
import { mcpUninstallCommand } from "./uninstall.js";

export { type RunMcpInstallInput, runMcpInstall, mcpInstallCommand } from "./install.js";
export { type RunMcpRepairInput, runMcpRepair, mcpRepairCommand } from "./repair.js";
export { type RunMcpServeDeps, runMcpServe, mcpServeCommand } from "./serve.js";
export { type RunMcpStatusInput, runMcpStatus, mcpStatusCommand } from "./status.js";
export { type RunMcpUninstallInput, runMcpUninstall, mcpUninstallCommand } from "./uninstall.js";

export const mcpCommand = defineCommand({
  meta: { name: "mcp", description: "Manage the Mega Saver MCP server installation." },
  subCommands: {
    install: mcpInstallCommand,
    repair: mcpRepairCommand,
    serve: mcpServeCommand,
    status: mcpStatusCommand,
    uninstall: mcpUninstallCommand,
  },
});
