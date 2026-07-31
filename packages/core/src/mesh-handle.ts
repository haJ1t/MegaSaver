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

export interface ResolveMeshOptions {
  requestedWorkspacePath: string;
  requestedRunNamespace: string;
}

/**
 * Parses a canonical msr://<ws>/<ns>/<hash>#kind URI into structured components.
 * Returns null if URI format is invalid.
 */
export function parseMeshUri(uri: string): {
  workspaceKey: WorkspaceKey;
  runNamespace: string;
  contentHash: string;
  kind: string;
} | null {
  if (!uri.startsWith("msr://")) return null;

  const withoutScheme = uri.slice(6); // remove msr://
  const [pathPart, kindPart] = withoutScheme.split("#");
  if (!pathPart) return null;

  const segments = pathPart.split("/");
  if (segments.length !== 3) return null;

  const [workspaceKey, runNamespace, contentHash] = segments;
  if (!workspaceKey || !runNamespace || !contentHash) return null;

  return {
    workspaceKey: workspaceKey as WorkspaceKey,
    runNamespace,
    contentHash,
    kind: kindPart ?? "chunk-set",
  };
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

/**
 * Resolves a MeshHandle or URI from the CAS store with I8 workspace & namespace protection.
 * Rejects resolution if requested workspaceKey or runNamespace does not match the handle (workspace_mismatch).
 */
export function resolveMeshHandle(
  handleOrUri: MeshHandle | string,
  store: Map<string, string>,
  options?: ResolveMeshOptions,
): string | null {
  const uri = typeof handleOrUri === "string" ? handleOrUri : handleOrUri.uri;

  if (options) {
    const parsed = parseMeshUri(uri);
    if (parsed) {
      const requestedKey = encodeWorkspaceKey(options.requestedWorkspacePath);
      if (
        requestedKey !== parsed.workspaceKey ||
        options.requestedRunNamespace !== parsed.runNamespace
      ) {
        // I8 Enforcement: Reject cross-workspace / cross-namespace resolution
        return null;
      }
    } else if (typeof handleOrUri !== "string") {
      const requestedKey = encodeWorkspaceKey(options.requestedWorkspacePath);
      if (
        requestedKey !== handleOrUri.workspaceKey ||
        options.requestedRunNamespace !== handleOrUri.runNamespace
      ) {
        return null;
      }
    }
  }

  return store.get(uri) ?? null;
}
