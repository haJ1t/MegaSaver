import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";

export type LocatedChunkSet = { projectId: ProjectId; sessionId: SessionId };

// Walks <store>/content/<projectId>/<sessionId>/ for <chunkSetId>.json.
// Chunk-set ids are globally unique (§3d), so the first match owns it.
// Schema/ownership validation is delegated to loadChunkSet, not done here.
export function locateChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
}): LocatedChunkSet | null {
  const contentRoot = join(input.storeRoot, "content");
  if (!existsSync(contentRoot)) return null;

  const fileName = `${input.chunkSetId}.json`;
  for (const projectDir of readdirSync(contentRoot)) {
    const projectPath = join(contentRoot, projectDir);
    for (const sessionDir of readdirSync(projectPath)) {
      const sessionPath = join(projectPath, sessionDir);
      if (existsSync(join(sessionPath, fileName))) {
        return {
          projectId: projectDir as unknown as ProjectId,
          sessionId: sessionDir as unknown as SessionId,
        };
      }
    }
  }
  return null;
}
