import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type PointerResolution,
  type WriteResolution,
  classifyEvidencePointer,
  locateChunkSet,
} from "@megasaver/core";
import { type ProjectId, type SessionId, encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { resolveEvidenceForMemory } from "./evidence-resolver.js";

const UUID_SHAPE = z.string().uuid();

async function resolveChunkSet(
  storeRoot: string,
  pointer: string,
  args: { projectId: ProjectId; sessionId: SessionId | null; projectRootPath: string },
): Promise<PointerResolution> {
  // Expected-path-first: a direct hit under the entry's own project/workspace
  // resolves without a store-wide walk, so a duplicated cs-id across projects
  // can never be readdir-order dependent.
  if (args.sessionId !== null) {
    const direct = [
      join(storeRoot, "content", args.projectId, args.sessionId, `${pointer}.json`),
      join(
        storeRoot,
        "content",
        encodeWorkspaceKey(args.projectRootPath),
        args.sessionId,
        `${pointer}.json`,
      ),
    ];
    if (direct.some((p) => existsSync(p))) {
      return { pointer, kind: "chunk_set", resolved: true };
    }
  }

  const located = locateChunkSet({ storeRoot, chunkSetId: pointer });
  if (located === null) {
    return { pointer, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" };
  }
  const workspaceKey = encodeWorkspaceKey(args.projectRootPath);
  const bound =
    located.layout === "registry"
      ? located.projectId === args.projectId &&
        (args.sessionId === null || located.sessionId === args.sessionId)
      : located.workspaceKey === workspaceKey &&
        (args.sessionId === null || located.liveSessionId === args.sessionId);
  if (!bound) {
    return { pointer, kind: "chunk_set", resolved: false, reason: "cross_workspace" };
  }
  return { pointer, kind: "chunk_set", resolved: true };
}

export async function resolveWritePointers(args: {
  storeRoot: string | undefined;
  evidence: readonly string[];
  projectRootPath: string;
  projectId: ProjectId;
  sessionId: SessionId | null;
}): Promise<WriteResolution> {
  const resolutions: PointerResolution[] = [];
  let unresolvedSecret = false;
  let hasRevoked = false;
  let hasCrossWorkspace = false;
  const resolverUnavailable = args.storeRoot === undefined;

  for (const pointer of args.evidence) {
    const kind = classifyEvidencePointer(pointer);
    if (kind === "lineage_note") continue;
    if (args.storeRoot === undefined) {
      resolutions.push({ pointer, kind, resolved: false, reason: "resolver_unavailable" });
      continue;
    }
    if (kind === "chunk_set") {
      const r = await resolveChunkSet(args.storeRoot, pointer, args);
      if (!r.resolved && r.reason === "cross_workspace") hasCrossWorkspace = true;
      resolutions.push(r);
      continue;
    }
    if (!UUID_SHAPE.safeParse(pointer).success) {
      resolutions.push({ pointer, kind: "ledger", resolved: false, reason: "invalid_pointer" });
      continue;
    }
    try {
      const res = await resolveEvidenceForMemory({
        storeRoot: args.storeRoot,
        evidenceIds: [pointer],
        projectRootPath: args.projectRootPath,
      });
      unresolvedSecret ||= res.unresolvedSecret;
      hasRevoked ||= res.hasRevoked;
      hasCrossWorkspace ||= res.hasCrossWorkspace;
      if (res.records.length === 1) {
        resolutions.push({ pointer, kind: "ledger", resolved: true });
      } else if (res.hasCrossWorkspace) {
        resolutions.push({ pointer, kind: "ledger", resolved: false, reason: "cross_workspace" });
      } else {
        resolutions.push({
          pointer,
          kind: "ledger",
          resolved: false,
          reason: "evidence_not_found",
        });
      }
    } catch {
      resolutions.push({ pointer, kind: "ledger", resolved: false, reason: "resolver_error" });
    }
  }

  return { resolutions, unresolvedSecret, hasRevoked, hasCrossWorkspace, resolverUnavailable };
}
