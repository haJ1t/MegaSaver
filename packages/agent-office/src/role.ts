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
    persona: z.string().min(1),
    model: roleModelSchema,
    // SECURITY: a leading '-' would be interpreted as a CLI flag when the role's
    // allowedTools are passed to the launcher. Reject it at this trust boundary
    // so every consumer (bridge, future Phase 5 CLI) is protected.
    allowedTools: z
      .array(z.string().min(1).regex(/^[^-]/, "tool must not start with '-'"))
      .readonly(),
    skillPacks: z.array(z.string()).readonly(),
    permissionMode: rolePermissionModeSchema,
    defaultWorkdir: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
