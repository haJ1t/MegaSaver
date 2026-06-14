import { createHash } from "node:crypto";
import { join } from "node:path";
import { type ProjectId, type WorkspaceKey, projectIdSchema } from "@megasaver/shared";
import type { IndexStorePaths } from "./store.js";

export function resolveWorkspaceIndexPaths(storeDir: string, key: WorkspaceKey): IndexStorePaths {
  const indexDir = join(storeDir, "index", key);
  return {
    indexDir,
    blocksPath: join(indexDir, "blocks.jsonl"),
    manifestPath: join(indexDir, "manifest.json"),
  };
}

// Fixed namespace for MegaSaver workspace keys (a random UUIDv4 frozen as a
// constant). workspaceProjectId derives a deterministic UUIDv5 from it so index
// blocks carry a schema-valid projectId without a schema migration (spec §6 R1).
const WORKSPACE_NAMESPACE = "6f8a2c1e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

function uuidv5(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const bytes = hash.subarray(0, 16);
  // biome-ignore lint/style/noNonNullAssertion: 16-byte SHA-1 digest slice is always full.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // biome-ignore lint/style/noNonNullAssertion: 16-byte SHA-1 digest slice is always full.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function workspaceProjectId(key: WorkspaceKey): ProjectId {
  return projectIdSchema.parse(uuidv5(WORKSPACE_NAMESPACE, key));
}
