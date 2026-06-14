import { z } from "zod";

// Overlay path segments. NOT lowercase-UUID: workspaceKey is the F3 cwd-derived
// hash and liveSessionId is the Claude transcript uuid (kept un-rebranded to
// avoid the projectId FK coupling). Both become filesystem path segments, so the
// only invariant is "safe segment" — never a containment-breaking value.
export function isSafeKeySegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== ".."
  );
}

export const workspaceKeySchema = z
  .string()
  .min(1)
  .refine(isSafeKeySegment)
  .brand<"WorkspaceKey">();
export type WorkspaceKey = z.infer<typeof workspaceKeySchema>;

export const liveSessionIdSchema = z
  .string()
  .min(1)
  .refine(isSafeKeySegment)
  .brand<"LiveSessionId">();
export type LiveSessionId = z.infer<typeof liveSessionIdSchema>;
