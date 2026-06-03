import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type ChunkSet, saveChunkSet } from "@megasaver/content-store";
import {
  type FilterOutputResult,
  filterOutput,
  resolveSafeReadPath,
} from "@megasaver/output-filter";
import { type ProjectPermissions, evaluatePathRead } from "@megasaver/policy";
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";
import { loadProjectPermissions } from "./load-project-permissions.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import type { GateResult, ResolveResult } from "./types.js";

export function defaultNow(): string {
  return new Date().toISOString();
}

export function defaultNewId(): string {
  return randomUUID();
}

// Injectable so orchestrator tests drive absent/valid/throwing without a real
// filesystem — same convention as spawn/now/newId (permissions-yaml §5.2).
export type LoadProjectPermissions = (projectRoot: string) => ProjectPermissions | null;

// Pre-AA sessions (§4c) carry no tokenSaver blob; derive read-only defaults
// rather than writing the session record. The project permissions file loads
// HERE, once per resolve, at the same boundary as projectRoot (§5.1). The
// loader can throw a PolicyLoadError on a present-but-malformed file; that
// becomes the typed policy_load_failed result rather than propagating, so the
// entry points can shut the gate before any spawn / fs.readFile (I3).
export function resolveEffectiveSettings(
  registry: OrchestratorRegistry,
  sessionId: SessionId,
  loadPermissions: LoadProjectPermissions = loadProjectPermissions,
): ResolveResult {
  const session = registry.getSession(sessionId);
  if (session === null) return { ok: false, reason: "session_not_found" };
  const project = registry.getProject(session.projectId);
  if (project === null) return { ok: false, reason: "session_not_found" };

  let permissions: ProjectPermissions | null;
  try {
    permissions = loadPermissions(project.rootPath);
  } catch (err) {
    return {
      ok: false,
      reason: "policy_load_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const tokenSaver = session.tokenSaver;
  return {
    ok: true,
    settings: {
      projectId: session.projectId,
      projectRoot: project.rootPath,
      mode: tokenSaver?.mode ?? "balanced",
      maxReturnedBytes: tokenSaver?.maxReturnedBytes,
      storeRawOutput: tokenSaver?.storeRawOutput ?? true,
      permissions,
    },
  };
}

// Two-gate read safety (§8): policy denylist, then sandbox resolver. Both
// run before any fs.readFile so a denied path is never read. The project
// permissions (deny.read globs) widen gate 1 only — gate 2 (the symlink/..
// resolver) is untouched (permissions-yaml §4 I4).
export function runTwoGates(input: {
  path: string;
  projectId: ProjectId;
  projectRoot: string;
  permissions: ProjectPermissions | null;
}): GateResult {
  const policy = evaluatePathRead({
    path: input.path,
    project: input.projectId,
    ...(input.permissions !== null ? { permissions: input.permissions } : {}),
  });
  if (!policy.allowed) return { ok: false, code: "path_denied", reason: policy.reason };

  let absolute: string;
  try {
    absolute = resolveSafeReadPath({ path: input.path, projectRoot: input.projectRoot }).absolute;
  } catch (err) {
    return { ok: false, code: "path_unsafe", message: err instanceof Error ? err.message : "" };
  }
  return { ok: true, absolute };
}

export async function readAndFilter(input: {
  absolute: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
}): Promise<
  { ok: true; raw: string; result: FilterOutputResult } | { ok: false; message: string }
> {
  let raw: string;
  try {
    raw = await readFile(input.absolute, "utf8");
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "read failed" };
  }
  const result = filterOutput({
    raw,
    intent: input.intent,
    mode: input.mode,
    ...(input.maxReturnedBytes !== undefined ? { maxReturnedBytes: input.maxReturnedBytes } : {}),
    source: { kind: "file", path: input.path },
  });
  return { ok: true, raw, result };
}

export async function persistChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
  sessionId: SessionId;
  projectId: ProjectId;
  createdAt: string;
  path: string;
  result: FilterOutputResult;
}): Promise<void> {
  const chunkSet: ChunkSet = {
    chunkSetId: input.chunkSetId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    createdAt: input.createdAt,
    source: { kind: "file", path: input.path },
    rawBytes: input.result.rawBytes,
    redacted: (input.result.warnings ?? []).some((w) => w.startsWith("redacted")),
    chunks: input.result.excerpts.map((e, i) => ({
      id: String(i),
      startLine: e.startLine,
      endLine: e.endLine,
      bytes: Buffer.byteLength(e.text, "utf8"),
      text: e.text,
    })),
  };
  await saveChunkSet({ storeRoot: input.storeRoot, chunkSet });
}
