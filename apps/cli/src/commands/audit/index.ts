import { defineCommand } from "citty";
import { auditExportCommand } from "./export.js";
import { auditHonestCommand } from "./honest.js";
import { auditLastCommand } from "./last.js";
import { auditReportCommand } from "./report.js";
import { auditSessionCommand } from "./session.js";
import { auditUsageCommand } from "./usage.js";

export { type RunAuditReportInput, runAuditReport, auditReportCommand } from "./report.js";
export { type RunAuditLastInput, runAuditLast, auditLastCommand } from "./last.js";
export { type RunAuditSessionInput, runAuditSession, auditSessionCommand } from "./session.js";
export { type RunAuditExportInput, runAuditExport, auditExportCommand } from "./export.js";
export { renderHonestReport, auditHonestCommand } from "./honest.js";
export {
  type RunAuditUsageInput,
  runAuditUsage,
  renderUsageReport,
  auditUsageCommand,
} from "./usage.js";

export const auditCommand = defineCommand({
  meta: {
    name: "audit",
    description: "Token-savings dashboard: report, last, session, export, honest, usage.",
  },
  subCommands: {
    report: auditReportCommand,
    last: auditLastCommand,
    session: auditSessionCommand,
    export: auditExportCommand,
    honest: auditHonestCommand,
    usage: auditUsageCommand,
  },
});
