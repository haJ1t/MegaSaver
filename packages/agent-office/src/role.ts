import { agentIdSchema, roleIdSchema, titleSchema } from "@megasaver/shared";
import { z } from "zod";

export const rolePermissionModeSchema = z.enum(["plan", "acceptEdits", "full"]);
export type RolePermissionMode = z.infer<typeof rolePermissionModeSchema>;

export const roleModelSchema = z.enum(["opus", "sonnet", "haiku"]);
export type RoleModel = z.infer<typeof roleModelSchema>;

export const roleSchema = z
  .object({
    id: roleIdSchema,
    name: titleSchema,
    kind: agentIdSchema,
    persona: z.string(),
    model: roleModelSchema,
    allowedTools: z.array(z.string()).readonly(),
    skillPacks: z.array(z.string()).readonly(),
    permissionMode: rolePermissionModeSchema,
    defaultWorkdir: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
