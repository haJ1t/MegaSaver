import { officeAgentIdSchema, officeTaskIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";

export const taskStatusSchema = z.enum(["canceled", "done", "failed", "queued", "running"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const officeTaskSchema = z
  .object({
    id: officeTaskIdSchema,
    agentId: officeAgentIdSchema,
    workspaceKey: workspaceKeySchema,
    instruction: z.string().min(1),
    status: taskStatusSchema,
    queuedAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).optional(),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    exitCode: z.number().int().optional(),
    evidenceId: z.string().min(1).optional(),
  })
  .strict();

export type OfficeTask = z.infer<typeof officeTaskSchema>;
