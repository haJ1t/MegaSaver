import { createHash } from "node:crypto";

const WORKSPACE_KEY_HEX_LEN = 16;

export function encodeWorkspaceKey(cwd: string): string {
  return createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, WORKSPACE_KEY_HEX_LEN);
}
