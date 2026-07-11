import { z } from "zod";
import { decrypt, encrypt } from "./crypto.js";
import { BrainSyncError } from "./errors.js";

export const MANIFEST_KEY = "manifest.json.enc";
export const MANIFEST_AAD = "megasaver-brain-sync:v1:manifest";

export function objectAad(objectKey: string): string {
  return `megasaver-brain-sync:v1:object:${objectKey}`;
}

export const syncManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
    brainSha256: z.string().regex(/^[0-9a-f]{64}$/),
    objectKey: z.string().regex(/^objects\/[0-9a-f-]{36}\.enc$/),
  })
  .strict();

export type SyncManifest = z.infer<typeof syncManifestSchema>;

export function sealManifest(manifest: SyncManifest, key: Uint8Array): Buffer {
  return encrypt(Buffer.from(JSON.stringify(manifest), "utf8"), key, MANIFEST_AAD);
}

export function openManifest(blob: Uint8Array, key: Uint8Array): SyncManifest {
  const text = decrypt(blob, key, MANIFEST_AAD).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrainSyncError("manifest_invalid", "decrypted manifest is not JSON");
  }
  const result = syncManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new BrainSyncError(
      "manifest_invalid",
      `manifest failed validation: ${result.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  return result.data;
}
