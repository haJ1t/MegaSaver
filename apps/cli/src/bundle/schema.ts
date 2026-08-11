import { createHash } from "node:crypto";
import { z } from "zod";

export const evidenceBundleSchema = z
  .object({
    version: z.literal(1),
    bundleId: z.string().regex(/^[a-f0-9]{12}$/),
    createdAt: z.string().datetime({ offset: true }),
    git: z.object({
      base: z.string().nullable(),
      head: z.string().nullable(),
      baseOid: z.string().nullable(),
      headOid: z.string().nullable(),
    }).passthrough(),
    preflight: z.object({ snapshotIds: z.array(z.string()).nullable() }).passthrough().nullable(),
    sweep: z.object({ quarantineId: z.string().nullable() }).passthrough().nullable(),
    tests: z.object({ receipts: z.array(z.any()), verified: z.boolean() }).passthrough(),
    context: z.object({ scorerConfigHash: z.string().nullable() }).passthrough().nullable(),
    lineage: z.object({ bundleHash: z.string(), storeRootHash: z.string() }).passthrough(),
    redacted: z.boolean(),
  })
  .passthrough();

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

export function bundleIdOf(bundleWithoutId: Omit<EvidenceBundle, "bundleId">): string {
  const hash = createHash("sha256").update(canonicalJson(bundleWithoutId)).digest("hex");
  return hash.slice(0, 12);
}
