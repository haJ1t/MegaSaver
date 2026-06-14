import { join } from "node:path";
import type { WorkspaceKey } from "@megasaver/shared";
import type { IndexStorePaths } from "./store.js";

export function resolveWorkspaceIndexPaths(storeDir: string, key: WorkspaceKey): IndexStorePaths {
  const indexDir = join(storeDir, "index", key);
  return {
    indexDir,
    blocksPath: join(indexDir, "blocks.jsonl"),
    manifestPath: join(indexDir, "manifest.json"),
  };
}
