import { z } from "zod";

export const fileAnchorSchema = z
  .object({
    path: z.string().min(1), // repo-relative, POSIX separators
    blobSha: z.string().min(1), // git blob SHA at capture
  })
  .strict();
export type FileAnchor = z.infer<typeof fileAnchorSchema>;

export const symbolAnchorSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string().min(1), // indexer hashText over the block span
  })
  .strict();
export type SymbolAnchor = z.infer<typeof symbolAnchorSchema>;

export const codeAnchorSchema = z
  .object({
    repoHead: z.string().min(1), // HEAD sha at capture
    capturedAt: z.string().datetime({ offset: true }),
    files: z.array(fileAnchorSchema),
    symbols: z.array(symbolAnchorSchema),
  })
  .strict();
export type CodeAnchor = z.infer<typeof codeAnchorSchema>;

export const verificationResultSchema = z.enum(["verified", "contradicted", "healed"]);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const lastVerifiedSchema = z
  .object({
    headSha: z.string().min(1),
    at: z.string().datetime({ offset: true }),
    result: verificationResultSchema,
    // Close ownership (architect B1): true ONLY when the contradiction
    // mutation itself closed validTo (found the row open). Heal may reopen
    // validTo only when this is true — a close owned by the lineage channel
    // (supersession, manual close) is never stomped by a code-truth heal.
    closedByCodeTruth: z.boolean(),
  })
  .strict();
export type LastVerified = z.infer<typeof lastVerifiedSchema>;
