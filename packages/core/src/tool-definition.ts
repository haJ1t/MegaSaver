import { titleSchema, toolDefinitionIdSchema } from "@megasaver/shared";
import { z } from "zod";

// Order: roadmap declaration order (Phase 7). Functional grouping of what a
// tool touches; the last three (database, deploy, dangerous) are the
// blocked-by-category set (see tool-router.ts). AA3: declaration order is a contract.
export const toolCategorySchema = z.enum([
  "filesystem",
  "search",
  "git",
  "test",
  "package",
  "database",
  "deploy",
  "browser",
  "dangerous",
]);
export type ToolCategory = z.infer<typeof toolCategorySchema>;

// Order: ascending blast radius (safe < medium < dangerous). AA3.
export const toolRiskSchema = z.enum(["safe", "medium", "dangerous"]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

// Keywords are a retrieval surface (BM25 over name+description+keywords), so
// they are normalized exactly like memory-entry keywords: lowercased, trimmed,
// de-duplicated, empties dropped. Order of first appearance is preserved.
const toolKeywordsSchema = z.array(z.string()).transform((raw) => {
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

export const toolDefinitionSchema = z
  .object({
    id: toolDefinitionIdSchema,
    workspaceKey: z.string().min(1),
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    // Opaque, descriptive only — the router never reads or executes these.
    // z.unknown() so any JSON-shaped value round-trips through the store
    // without the engine taking a dependency on a tool's I/O contract.
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    keywords: toolKeywordsSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

// Caller-supplied tool metadata: the fields the agent/developer writes.
// id/createdAt are engine-owned; inputSchema/outputSchema are optional opaque
// JSON defaulted to null by buildToolDefinitionFromInput.
export const toolDefinitionInputSchema = z
  .object({
    name: titleSchema,
    description: z.string().trim().min(1),
    category: toolCategorySchema,
    risk: toolRiskSchema,
    keywords: z.array(z.string()).default([]),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
  })
  .strict();

export type ToolDefinitionInput = z.infer<typeof toolDefinitionInputSchema>;
