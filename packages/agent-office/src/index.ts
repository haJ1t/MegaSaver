export {
  roleSchema,
  rolePermissionModeSchema,
  roleModelSchema,
  type Role,
  type RolePermissionMode,
  type RoleModel,
} from "./role.js";

export {
  officeAgentSchema,
  agentStatusSchema,
  type OfficeAgent,
  type AgentStatus,
} from "./agent.js";

export {
  officeTaskSchema,
  taskStatusSchema,
  type OfficeTask,
  type TaskStatus,
} from "./task.js";

export {
  AgentOfficeError,
  agentOfficeErrorCodeSchema,
  type AgentOfficeErrorCode,
} from "./errors.js";

export { saveRole, loadRole, listRoles, deleteRole } from "./role-store.js";
export { saveAgent, loadAgent, listAgents, deleteAgent } from "./agent-store.js";
export { saveTask, loadTask, listTasks, deleteTask } from "./task-store.js";
export { buildPredefinedRoles, ensurePredefinedRoles } from "./predefined-roles.js";

export { resolveLauncherPermission } from "./permission.js";

export {
  createLauncherRegistry,
  type LauncherRegistry,
} from "./launcher-registry.js";

export {
  auditEventSchema,
  auditEventTypeSchema,
  type AuditEvent,
  type AuditEventType,
} from "./audit.js";

export { appendAudit, listAudit } from "./audit-store.js";

export {
  transcriptEntrySchema,
  transcriptRoleSchema,
  projectEvent,
  type TranscriptEntry,
  type TranscriptEntryInput,
  type TranscriptRole,
} from "./transcript.js";

export { appendTranscript, listTranscript } from "./transcript-store.js";

export {
  createSupervisor,
  type Supervisor,
} from "./supervisor.js";

export { OFFICE_PROJECT_ID, ensureOfficeProject } from "./office-project.js";
