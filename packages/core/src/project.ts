import { projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1),
    rootPath: z.string().trim().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
