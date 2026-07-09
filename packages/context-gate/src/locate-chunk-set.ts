import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";

export type LocatedChunkSet =
  | { layout: "registry"; projectId: ProjectId; sessionId: SessionId }
  | { layout: "overlay"; workspaceKey: string; liveSessionId: string };

// Overlay dirs are 16-hex workspaceKeys (encodeWorkspaceKey); registry dirs
// are UUID project ids — the two shapes never collide.
const WORKSPACE_KEY_DIR = /^[0-9a-f]{16}$/;

// Walks <store>/content/<topDir>/<sessionDir>/ for <chunkSetId>.json.
// Chunk-set ids are globally unique (§3d), so the first match owns it.
// Schema/ownership validation is delegated to the loaders, not done here.
export function locateChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
}): LocatedChunkSet | null {
  const contentRoot = join(input.storeRoot, "content");
  if (!existsSync(contentRoot)) return null;

  const fileName = `${input.chunkSetId}.json`;
  for (const topDir of readdirSync(contentRoot)) {
    const topPath = join(contentRoot, topDir);
    if (!statSync(topPath).isDirectory()) continue;
    for (const sessionDir of readdirSync(topPath)) {
      const sessionPath = join(topPath, sessionDir);
      if (!statSync(sessionPath).isDirectory()) continue;
      if (existsSync(join(sessionPath, fileName))) {
        return WORKSPACE_KEY_DIR.test(topDir)
          ? { layout: "overlay", workspaceKey: topDir, liveSessionId: sessionDir }
          : {
              layout: "registry",
              projectId: topDir as unknown as ProjectId,
              sessionId: sessionDir as unknown as SessionId,
            };
      }
    }
  }
  return null;
}
