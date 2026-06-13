import { defineCommand } from "citty";
import { contextAuditCommand } from "./audit.js";
import { contextBuildCommand } from "./build.js";
import { contextExplainCommand } from "./explain.js";
import { contextExportCommand } from "./export.js";

export { type RunContextBuildInput, runContextBuild, contextBuildCommand } from "./build.js";
export {
  type RunContextExplainInput,
  runContextExplain,
  contextExplainCommand,
} from "./explain.js";
export { type RunContextAuditInput, runContextAudit, contextAuditCommand } from "./audit.js";
export { type RunContextExportInput, runContextExport, contextExportCommand } from "./export.js";

export const contextCommand = defineCommand({
  meta: { name: "context", description: "Build and inspect task-aware context packs." },
  subCommands: {
    build: contextBuildCommand,
    explain: contextExplainCommand,
    audit: contextAuditCommand,
    export: contextExportCommand,
  },
});
