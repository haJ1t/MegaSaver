import { z } from "zod";

export const memoryInputSchema = z.object({
  id: z.string(),
  scope: z.enum(["project", "session"]),
  sessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  memoryType: z.string(),
  title: z.string(),
  approval: z.string(),
  confidence: z.string(),
  source: z.string(),
  stale: z.boolean(),
  evidenceIds: z.array(z.string()),
  relatedFiles: z.array(z.string()).default([]),
  relatedSymbols: z.array(z.string()).default([]),
});
export type MemoryInput = z.infer<typeof memoryInputSchema>;

export const evidenceInputSchema = z.object({
  evidenceId: z.string(),
  sourceKind: z.string(),
  sessionId: z.string().nullable(),
  chunkSetIds: z.array(z.string()),
  status: z.string(),
});
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const sessionInputSchema = z.object({ id: z.string(), projectId: z.string().nullable() });
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const projectInputSchema = z.object({ id: z.string(), name: z.string() });
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const chunkSetInputSchema = z.object({
  chunkSetId: z.string(),
  label: z.string(),
  redacted: z.boolean(),
});
export type ChunkSetInput = z.infer<typeof chunkSetInputSchema>;

export const conflictPairSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["conflict", "supersede", "duplicate"]),
});
export type ConflictPair = z.infer<typeof conflictPairSchema>;

export const fileInputSchema = z.object({ path: z.string() });
export type FileInput = z.infer<typeof fileInputSchema>;

export const symbolInputSchema = z.object({ symbol: z.string() });
export type SymbolInput = z.infer<typeof symbolInputSchema>;

export const wikiInputSchema = z.object({
  path: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.string(),
  links: z.array(z.string()),
  sources: z.array(z.string()),
  fileCites: z.array(z.string()),
});
export type WikiInput = z.infer<typeof wikiInputSchema>;

export const graphInputSchema = z.object({
  projects: z.array(projectInputSchema),
  sessions: z.array(sessionInputSchema),
  memories: z.array(memoryInputSchema),
  evidence: z.array(evidenceInputSchema),
  chunkSets: z.array(chunkSetInputSchema),
  conflicts: z.array(conflictPairSchema),
  files: z.array(fileInputSchema).default([]),
  symbols: z.array(symbolInputSchema).default([]),
  wikiPages: z.array(wikiInputSchema).default([]),
});
export type GraphInput = z.infer<typeof graphInputSchema>;
