import { z } from "zod";

export const nodeKindSchema = z.enum([
  "project",
  "session",
  "memory",
  "evidence",
  "chunkset",
  "file",
  "symbol",
  "wiki",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const edgeKindSchema = z.enum([
  "contains",
  "scope",
  "project-memory",
  "cites",
  "chunk-of",
  "from-session",
  "conflict",
  "supersede",
  "duplicate",
  "code-link",
  "wiki-link",
  "wiki-source",
  "wiki-cite",
]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;

export const graphNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: nodeKindSchema,
    label: z.string(),
    meta: z.record(z.string(), z.unknown()),
  })
  .strict();
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z
  .object({
    id: z.string().min(1),
    kind: edgeKindSchema,
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphSchema = z
  .object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    stats: z.object({ nodeCount: z.number().int(), edgeCount: z.number().int() }),
  })
  .strict();
export type Graph = z.infer<typeof graphSchema>;
