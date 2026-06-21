import {
  agentIdSchema,
  officeAgentIdSchema,
  roleIdSchema,
  sessionIdSchema,
  titleSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const agentStatusSchema = z.enum(["error", "idle", "paused", "stopped", "working"]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const officeAgentSchema = z
  .object({
    id: officeAgentIdSchema,
    name: titleSchema,
    roleId: roleIdSchema,
    kind: agentIdSchema,
    workspaceKey: z.string().min(1),
    workdir: z.string().min(1),
    status: agentStatusSchema,
    claudeSessionId: z.string().min(1).optional(),
    coreSessionId: sessionIdSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type OfficeAgent = z.infer<typeof officeAgentSchema>;
