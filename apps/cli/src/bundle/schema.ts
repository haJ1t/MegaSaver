import { createHash } from "node:crypto";
import { z } from "zod";

export const evidenceBundleSchema = z
  .object({
    version: z.literal(1),
    bundleId: z.string().regex(/^[a-f0-9]{12}$/),
    createdAt: z.string().datetime({ offset: true }),
    git: z
      .object({
        base: z.string().nullable(),
        head: z.string().nullable(),
        baseOid: z.string().nullable(),
        headOid: z.string().nullable(),
      })
      .strict(),
    preflight: z
      .object({ snapshotIds: z.array(z.string()).nullable() })
      .strict()
      .nullable(),
    sweep: z.object({ quarantineId: z.string().nullable() }).strict().nullable(),
    tests: z.object({ receipts: z.array(z.any()), verified: z.boolean() }).strict(),
    context: z.object({ scorerConfigHash: z.string().nullable() }).strict().nullable(),
    lineage: z.object({ bundleHash: z.string(), storeRootHash: z.string() }).strict(),
    redacted: z.boolean(),
  })
  .strict();

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value as unknown;
  });
}

export function bundleIdOf(bundleWithoutId: Omit<EvidenceBundle, "bundleId">): string {
  const hash = createHash("sha256").update(canonicalJson(bundleWithoutId)).digest("hex");
  return hash.slice(0, 12);
}
