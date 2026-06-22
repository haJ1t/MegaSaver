import {
  agentIdSchema,
  officeAgentIdSchema,
  officeTaskIdSchema,
  sessionIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { z } from "zod";
import { rolePermissionModeSchema } from "./role.js";

export const auditEventTypeSchema = z.enum(["spawn", "task_done", "task_failed"]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditEventSchema = z
  .object({
    id: z.string().min(1),
    ts: z.string().datetime({ offset: true }),
    type: auditEventTypeSchema,
    workspaceKey: workspaceKeySchema,
    officeAgentId: officeAgentIdSchema,
    taskId: officeTaskIdSchema,
    kind: agentIdSchema,
    permissionMode: rolePermissionModeSchema,
    workdir: z.string().min(1),
    coreSessionId: sessionIdSchema,
    claudeSessionId: z.string().min(1),
    exitCode: z.number().int().nullable().optional(),
  })
  .strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;
