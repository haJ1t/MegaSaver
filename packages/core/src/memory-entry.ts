import {
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
  titleSchema,
} from "@megasaver/shared";
import { z } from "zod";

// Order: semantic — project precedes session because sessions belong to
// projects (containment hierarchy). Used for derived CLI strings.
export const memoryScopeSchema = z.enum(["project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

// Order: the ten engineering-memory categories, in roadmap declaration
// order (Phase 1 DIMMEM). AA3 convention: declaration order is a contract.
export const memoryTypeSchema = z.enum([
  "decision",
  "bug",
  "architecture",
  "todo",
  "user_preference",
  "failed_attempt",
  "code_pattern",
  "project_rule",
  "dependency",
  "test_behavior",
]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

// Order: ascending trust.
export const memoryConfidenceSchema = z.enum(["low", "medium", "high"]);
export type MemoryConfidence = z.infer<typeof memoryConfidenceSchema>;

// Order: where the memory came from, roadmap order.
export const memorySourceSchema = z.enum([
  "manual",
  "agent",
  "test_failure",
  "git_diff",
  "session_summary",
]);
export type MemorySource = z.infer<typeof memorySourceSchema>;

// Keywords are a retrieval surface (BM25 over title+content+keywords), so
// they are normalized to a stable form: lowercased, trimmed, de-duplicated,
// empties dropped. Order of first appearance is preserved.
const keywordsSchema = z.array(z.string()).transform((raw) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
});

export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema.nullable(),
    scope: memoryScopeSchema,
    type: memoryTypeSchema,
    title: titleSchema,
    content: z.string().trim().min(1),
    keywords: keywordsSchema,
    confidence: memoryConfidenceSchema,
    source: memorySourceSchema,
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    evidence: z.array(z.string()).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    stale: z.boolean().default(false),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === null) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }

    if (entry.scope === "project" && entry.sessionId !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

// Partial update over the MUTABLE fields only. id/projectId/createdAt/scope/
// sessionId are immutable after create; `.strict()` rejects them so a bad
// caller fails loudly. `updatedAt` is required — the caller (CLI/MCP) owns the
// clock, mirroring the create path where timestamps are passed in, not minted
// inside the registry.
export const memoryEntryUpdatePatchSchema = z
  .object({
    type: memoryTypeSchema.optional(),
    title: titleSchema.optional(),
    content: z.string().trim().min(1).optional(),
    keywords: keywordsSchema.optional(),
    confidence: memoryConfidenceSchema.optional(),
    source: memorySourceSchema.optional(),
    reason: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(1).optional(),
    evidence: z.array(z.string()).optional(),
    relatedFiles: z.array(z.string()).optional(),
    relatedSymbols: z.array(z.string()).optional(),
    stale: z.boolean().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type MemoryEntryUpdatePatch = z.infer<typeof memoryEntryUpdatePatchSchema>;

const LEGACY_TITLE_MAX = 59;

// v0.1 memory rows predate the typed DIMMEM schema. Backfill them to neutral
// defaults at the read boundary so existing on-disk stores keep loading. A row
// is "legacy" iff it lacks `type`; already-typed rows pass through untouched,
// so this is idempotent.
export function backfillMemoryEntry(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || "type" in raw) {
    return raw;
  }
  const entry = raw as { content?: unknown; createdAt?: unknown };
  const content = typeof entry.content === "string" ? entry.content : "";
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : undefined;
  const title = content.trim().slice(0, LEGACY_TITLE_MAX) || "untitled";
  return {
    ...(raw as Record<string, unknown>),
    type: "todo",
    title,
    keywords: [],
    confidence: "low",
    source: "manual",
    stale: false,
    ...(createdAt === undefined ? {} : { updatedAt: createdAt }),
  };
}
