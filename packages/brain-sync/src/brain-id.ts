import { createHash } from "node:crypto";

// Cross-machine-stable brain identity: two machines that share the key (via
// the recovery code) and name the project the same derive the SAME id, so
// they resolve to the same remote prefix + AAD. Salting by the secret key
// hides the project name from the storage provider (no bare-name dictionary
// attack). Different name → different id → AAD auth fails (cross-brain
// transplant protection).
export function deriveBrainId(key: Uint8Array, projectName: string): string {
  const normalized = projectName.trim().toLowerCase();
  return createHash("sha256").update(key).update(normalized, "utf8").digest("hex");
}
