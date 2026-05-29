import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type ChunkSet, saveChunkSet } from "@megasaver/content-store";
import type { CoreRegistry } from "@megasaver/core";
import {
  type FilterOutputResult,
  filterOutput,
  resolveSafeReadPath,
} from "@megasaver/output-filter";
import { evaluatePathRead } from "@megasaver/policy";
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";

export type EffectiveSettings = {
  projectId: ProjectId;
  projectRoot: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  storeRawOutput: boolean;
};

export type PipelineEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
};

export function defaultNow(): string {
  return new Date().toISOString();
}

export function defaultNewId(): string {
  return randomUUID();
}

// Pre-AA sessions (§4c) carry no tokenSaver blob; derive read-only defaults
// rather than writing the session record.
export function resolveEffectiveSettings(
  registry: CoreRegistry,
  sessionId: SessionId,
): EffectiveSettings | null {
  const session = registry.getSession(sessionId);
  if (session === null) return null;
  const project = registry.getProject(session.projectId);
  if (project === null) return null;

  const tokenSaver = session.tokenSaver;
  return {
    projectId: session.projectId,
    projectRoot: project.rootPath,
    mode: tokenSaver?.mode ?? "balanced",
    maxReturnedBytes: tokenSaver?.maxReturnedBytes,
    storeRawOutput: tokenSaver?.storeRawOutput ?? true,
  };
}

export type GateResult =
  | { ok: true; absolute: string }
  | { ok: false; code: "path_denied"; reason: string }
  | { ok: false; code: "path_unsafe"; message: string };

// Two-gate read safety (§8): policy denylist, then sandbox resolver. Both
// run before any fs.readFile so a denied path is never read.
export function runTwoGates(input: {
  path: string;
  projectId: ProjectId;
  projectRoot: string;
}): GateResult {
  const policy = evaluatePathRead({ path: input.path, project: input.projectId });
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
