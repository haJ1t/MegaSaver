import { projectIdSchema, sessionFailureIdSchema, sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";

export type { SessionFailureId } from "@megasaver/shared";

export const sessionFailureSchema = z.object({
  id: sessionFailureIdSchema,
  projectId: projectIdSchema,
  sessionId: sessionIdSchema,
  command: z.string().trim().min(1),
  // Empty is allowed: a silent non-zero exit (no stdout/stderr) is a real,
  // capture-worthy failure. Only `command` must be non-empty.
  errorOutput: z.string(),
  source: z.literal("proxy-classifier"),
  createdAt: z.string().datetime({ offset: true }),
});
export type SessionFailure = z.infer<typeof sessionFailureSchema>;
