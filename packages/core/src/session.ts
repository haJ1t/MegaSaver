import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";

export const sessionSchema = z.object({
  id: sessionIdSchema,
  projectId: projectIdSchema,
  agentId: agentIdSchema,
  riskLevel: riskLevelSchema,
  title: z.string().trim().min(1).nullable(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
});

export type Session = z.infer<typeof sessionSchema>;
