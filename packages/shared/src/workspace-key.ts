import { z } from "zod";

// fs-safe, lowercase hex, fixed length — NOT a UUID. Distinct from projectIdSchema
// (lowercase-UUID brand) so the two key spaces never alias.
export const workspaceKeySchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, "workspaceKey must be 16 lowercase hex chars")
  .brand<"WorkspaceKey">();
export type WorkspaceKey = z.infer<typeof workspaceKeySchema>;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;

// 64-bit FNV-1a over the UTF-8 bytes of cwd → 16 lowercase hex. Deterministic and
// browser+node safe on purpose: node:crypto cannot be bundled into the GUI's
// vite/rollup browser build, and this key is consumed on both sides. It is a
// dedup identifier, not a security token — filesystem access to the overlay dir is
// gated separately by realpath containment checks (see safeWorkspaceOverlayDir).
export function encodeWorkspaceKey(cwd: string): WorkspaceKey {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(cwd)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & U64;
  }
  return workspaceKeySchema.parse(hash.toString(16).padStart(16, "0"));
}

export function workspaceLabel(cwd: string): string {
  return cwd;
}
