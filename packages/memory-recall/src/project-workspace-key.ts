import { createHash } from "node:crypto";
import { type ProjectId, type WorkspaceKey, workspaceKeySchema } from "@megasaver/shared";

export function projectWorkspaceKey(projectId: ProjectId): WorkspaceKey {
  return workspaceKeySchema.parse(
    createHash("sha256")
      .update(`megasaver.memory-recall.workspace.v1\0${projectId}`, "utf8")
      .digest("hex")
      .slice(0, 16),
  );
}
