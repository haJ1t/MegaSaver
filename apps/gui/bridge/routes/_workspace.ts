import { type WorkspaceKey, workspaceKeySchema } from "@megasaver/shared";
import type { RouteContext } from "../route-context.js";
import { zodErrorMessage } from "../zod-schemas.js";

// Validate a `/api/workspaces/:key/...` path param. Sends 400 validation_failed
// on a bad shape and returns null. No existence check: a missing overlay reads
// as empty (mirrors `index status indexed:false`), so the key needs only to be
// well-formed, not present on disk.
export function resolveWorkspaceKey(ctx: RouteContext, keyRaw: string): WorkspaceKey | null {
  const parsed = workspaceKeySchema.safeParse(keyRaw);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return null;
  }
  return parsed.data;
}
