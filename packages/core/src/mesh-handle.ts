import { createHash } from "node:crypto";
import { type WorkspaceKey, encodeWorkspaceKey } from "@megasaver/shared";

/**
 * Context Mesh CAS handle interface (I8 Compliance: Workspace & RunNamespace Guarded)
 */
export interface MeshHandle {
  uri: string;
  workspaceKey: WorkspaceKey;
  runNamespace: string;
  contentHash: string;
  sizeBytes: number;
  kind: "chunk-set" | "ast-skeleton" | "graph-slice" | "handoff" | "verdict";
}

/**
 * Mints a namespace-isolated MeshHandle (I8 compliance).
 * Prevents cross-session GC clobbering (E14 root cause fix).
 */
export function createMeshHandle(
  workspacePath: string,
  runNamespace: string,
  content: string,
  kind: MeshHandle["kind"] = "chunk-set",
): MeshHandle {
  if (!workspacePath || typeof workspacePath !== "string" || workspacePath.trim() === "") {
    throw new Error("createMeshHandle requires a non-empty workspacePath (I8 requirement)");
  }
  if (!runNamespace || typeof runNamespace !== "string" || runNamespace.trim() === "") {
    throw new Error("createMeshHandle requires a non-empty runNamespace (I8 requirement)");
  }

  const workspaceKey = encodeWorkspaceKey(workspacePath);
  const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const uri = `msr://${workspaceKey}/${runNamespace}/${contentHash}#${kind}`;

  return {
    uri,
    workspaceKey,
    runNamespace,
    contentHash,
    sizeBytes: Buffer.byteLength(content, "utf-8"),
    kind,
  };
}

export function resolveMeshHandle(uri: string, store: Map<string, string>): string | null {
  return store.get(uri) ?? null;
}
