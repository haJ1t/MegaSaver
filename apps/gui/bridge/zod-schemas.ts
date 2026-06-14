import {
  memoryConfidenceSchema,
  memoryEntryUpdatePatchSchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { knownAgentIdSchema } from "@megasaver/mcp-bridge";
import { titleSchema as TITLE_SCHEMA } from "@megasaver/shared";
import { z } from "zod";

// MCP setup bodies (epic §6c). target is a KnownAgentId (PARENT AMENDMENT):
// validate with knownAgentIdSchema from @megasaver/mcp-bridge, NOT agentIdSchema
// — the MCP install surface is the four MCP-capable agents only. install/repair
// need the project whose agent files receive the connector block (epic §7).
export const MEGA_MCP_TARGET_BODY = z
  .object({
    target: knownAgentIdSchema,
    project: z.string().min(1),
  })
  .strict();

export const MEGA_MCP_UNINSTALL_BODY = z
  .object({
    target: knownAgentIdSchema,
  })
  .strict();

// Memory PATCH (P0 approve/reject + P1 typed edits). Mirrors Core's update
// patch minus `updatedAt` (the route stamps it with now()). At least one
// editable field must be present.
export const MEMORY_PATCH_BODY = memoryEntryUpdatePatchSchema
  .omit({ updatedAt: true })
  .refine((p) => Object.keys(p).length > 0, {
    message: "PATCH body must contain at least one editable field.",
  });

// F4 live memory create surface. No projectId/sessionId/workspaceKey — the key
// is resolved server-side from the (dir,id) URL segments. `scope` alone picks
// session- vs workspace-scope; liveSessionId is the resolved session id.
export const CREATE_LIVE_MEMORY_BODY = z
  .object({
    content: z.string().trim().min(1),
    scope: memoryScopeSchema,
    type: memoryTypeSchema.optional(),
    title: TITLE_SCHEMA.optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : "Validation failed.";
}
