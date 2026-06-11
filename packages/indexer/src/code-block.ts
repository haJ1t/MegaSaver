import { codeBlockIdSchema, projectIdSchema } from "@megasaver/shared";
import { z } from "zod";

// Order: declaration order is a contract (AA3). The eight structural kinds a
// repo file decomposes into for task-aware retrieval.
export const blockTypeSchema = z.enum([
  "function",
  "class",
  "component",
  "route",
  "test",
  "config",
  "schema",
  "docs",
]);
export type BlockType = z.infer<typeof blockTypeSchema>;

export const codeBlockSchema = z
  .object({
    id: codeBlockIdSchema,
    projectId: projectIdSchema,
    filePath: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    blockType: blockTypeSchema,
    name: z.string().min(1).optional(),
    contentHash: z.string().min(1),
    summary: z.string().optional(),
    imports: z.array(z.string()),
    exports: z.array(z.string()),
    calls: z.array(z.string()),
    calledBy: z.array(z.string()),
    keywords: z.array(z.string()),
    lastModifiedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.endLine < block.startLine) {
      ctx.addIssue({
        code: "custom",
        message: "endLine must be >= startLine.",
        path: ["endLine"],
      });
    }
  });

export type CodeBlock = z.infer<typeof codeBlockSchema>;

// What an extractor returns: the block minus identity, which the indexer
// assigns (id) / injects (projectId) when persisting.
export type ExtractedBlock = Omit<CodeBlock, "id" | "projectId">;
