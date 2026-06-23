import { roleModelSchema, rolePermissionModeSchema } from "@megasaver/agent-office";
import { agentIdSchema, roleIdSchema, titleSchema } from "@megasaver/shared";
import { z } from "zod";

// SECURITY: a tool entry must not be able to inject a CLI flag when spread into
// the claude argv (e.g. "--add-dir"). Reject any entry starting with '-'.
export const allowedToolSchema = z.string().min(1).regex(/^[^-]/, "tool must not start with '-'");

export const roleCreateInputSchema = z
  .object({
    name: titleSchema,
    kind: agentIdSchema,
    persona: z.string().min(1),
    model: roleModelSchema,
    allowedTools: z.array(allowedToolSchema),
    skillPacks: z.array(z.string().min(1)),
    permissionMode: rolePermissionModeSchema,
    defaultWorkdir: z.string().min(1).optional(),
  })
  .strict();

export const agentCreateInputSchema = z
  .object({
    name: titleSchema,
    roleId: roleIdSchema,
    workdir: z.string().min(1),
  })
  .strict();

export const taskCreateInputSchema = z.object({ instruction: z.string().min(1) }).strict();

// trim()+min(1): the client trims, but the server is the trust boundary — reject
// a blank/whitespace message so it can't reach `claude -p` as the instruction.
export const chatInputSchema = z.object({ message: z.string().trim().min(1) }).strict();

export const controlInputSchema = z
  .object({ action: z.enum(["pause", "resume", "stop"]) })
  .strict();
