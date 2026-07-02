import { z } from "zod";

// Domain-separated SHA-256 of the canonical Git common-directory path, encoded
// base64url (no padding) with a gf1_ prefix. 43 chars = 32 digest bytes. The
// digest is computed node-side in @megasaver/context-gate (node:crypto cannot be
// bundled into the GUI browser build); this schema is the browser-safe validator,
// mirroring workspaceKeySchema. Distinct key space from WorkspaceKey so the two
// never alias.
export const repositoryFamilyKeySchema = z
  .string()
  .regex(/^gf1_[A-Za-z0-9_-]{43}$/, "repositoryFamilyKey must be gf1_ + 43 base64url chars")
  .brand<"RepositoryFamilyKey">();
export type RepositoryFamilyKey = z.infer<typeof repositoryFamilyKeySchema>;
