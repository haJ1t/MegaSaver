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

export const graphInputSchema = z.object({
  projects: z.array(projectInputSchema),
  sessions: z.array(sessionInputSchema),
  memories: z.array(memoryInputSchema),
  evidence: z.array(evidenceInputSchema),
  chunkSets: z.array(chunkSetInputSchema),
  conflicts: z.array(conflictPairSchema),
});
export type GraphInput = z.infer<typeof graphInputSchema>;
