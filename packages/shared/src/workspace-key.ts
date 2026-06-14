import { createHash } from "node:crypto";
import { z } from "zod";

// fs-safe, lowercase hex, fixed length — NOT a UUID. Distinct from projectIdSchema
// (lowercase-UUID brand) so the two key spaces never alias. 16 hex chars = 64 bits
// of sha256, collision-safe for a per-user workspace count.
export const workspaceKeySchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, "workspaceKey must be 16 lowercase hex chars")
  .brand<"WorkspaceKey">();
export type WorkspaceKey = z.infer<typeof workspaceKeySchema>;

export function encodeWorkspaceKey(cwd: string): WorkspaceKey {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return workspaceKeySchema.parse(hash);
}

export function workspaceLabel(cwd: string): string {
  return cwd;
}
