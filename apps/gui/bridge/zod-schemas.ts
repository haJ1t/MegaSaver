import {
  memoryConfidenceSchema,
  memoryEntryUpdatePatchSchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  projectSchema,
} from "@megasaver/core";
import { knownAgentIdSchema } from "@megasaver/mcp-bridge";
import {
  titleSchema as TITLE_SCHEMA,
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
  tokenSaverModeSchema,
} from "@megasaver/shared";
import { z } from "zod";

// Project create (P0). Name reuses Core's exact validation (trim/NFC/control-char
// rules) at the boundary so a bad name is a clean 400, not a 500 from Core's
// re-parse. rootPath existence/dir/readable is checked in the route (filesystem),
// not here.
export const CREATE_PROJECT_BODY = z
  .object({
    name: projectSchema.shape.name,
    rootPath: z.string().trim().min(1),
  })
  .strict();

export const ENABLE_TOKEN_SAVER_BODY = z
  .object({
    mode: tokenSaverModeSchema.optional(),
    maxReturnedBytes: z.number().int().positive().optional(),
    storeRawOutput: z.boolean().optional(),
    redactSecrets: z.boolean().optional(),
    autoRepair: z.boolean().optional(),
  })
  .strict();

export const DISABLE_TOKEN_SAVER_BODY = z.object({}).strict();

// Retention (epic 3d). Clear takes no body; deletion is scoped to the target
// session's chunk sets (never wider — see retention.ts).
export const CLEAR_RETENTION_BODY = z.object({}).strict();

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

export const CREATE_SESSION_BODY = z
  .object({
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    title: TITLE_SCHEMA.optional(),
    riskLevel: riskLevelSchema.optional().default("medium"),
  })
  .strict();

export const END_SESSION_BODY = z
  .object({
    endedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// PATCH body — subset of sessionUpdatePatchSchema (cannot import via cross-file
// because we need a tweaked title check that allows null and empty-string-as-null).
export const PATCH_SESSION_BODY = z
  .object({
    title: TITLE_SCHEMA.nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "PATCH body must contain at least one of title, riskLevel, agentId.",
  });

// Typed-memory create surface (P1, §3c): the GUI may now set the typed Phase-1
// fields instead of always defaulting type=todo/confidence=medium/source=manual.
// All typed fields are optional; the route fills neutral defaults when omitted.
export const CREATE_MEMORY_BODY = z
  .object({
    projectId: projectIdSchema,
    content: z.string().trim().min(1),
    scope: memoryScopeSchema,
    sessionId: sessionIdSchema.optional(),
    type: memoryTypeSchema.optional(),
    title: TITLE_SCHEMA.optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }
    if (entry.scope === "project" && entry.sessionId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

// Memory PATCH (P0 approve/reject + P1 typed edits). Mirrors Core's update
// patch minus `updatedAt` (the route stamps it with now()). At least one
// editable field must be present.
export const MEMORY_PATCH_BODY = memoryEntryUpdatePatchSchema
  .omit({ updatedAt: true })
  .refine((p) => Object.keys(p).length > 0, {
    message: "PATCH body must contain at least one editable field.",
  });

export function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : "Validation failed.";
}
