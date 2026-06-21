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
export { buildPredefinedRoles } from "./predefined-roles.js";
