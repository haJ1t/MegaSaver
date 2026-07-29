import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type ChunkSet,
  type OverlayChunkSet,
  saveChunkSet,
  saveOverlayChunkSet,
} from "@megasaver/content-store";
import {
  type FilterOutputResult,
  type SessionHints,
  engineRankingDisabledByEnv,
  filterOutput,
  resolveSafeReadPath,
} from "@megasaver/output-filter";
import {
  type PolicyDenyCode,
  type ProjectPermissions,
  evaluatePathRead,
  redact,
} from "@megasaver/policy";
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";
import { loadProjectPermissions } from "./load-project-permissions.js";
import { recoverableChunks } from "./recoverable-chunks.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import type { GateResult, OverlayEffectiveSettings, ResolveResult } from "./types.js";

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

// F4 live-first overlay resolver. The session model is gone here: the caller
// (a live bridge route) has already resolved cwd + permissions + the token-saver
// settings from the workspace overlay, so this is a pure pass-through. No
// registry, no project FK — settings flow straight from the caller's inputs.
export function resolveOverlayEffectiveSettings(input: {
  cwd: string;
  permissions: ProjectPermissions | null;
  mode: TokenSaverMode;
  maxReturnedBytes?: number | undefined;
  storeRawOutput: boolean;
}): OverlayEffectiveSettings {
  return {
    cwd: input.cwd,
    mode: input.mode,
    maxReturnedBytes: input.maxReturnedBytes,
    storeRawOutput: input.storeRawOutput,
    permissions: input.permissions,
  };
}

function denyReason(
  path: string,
  project: ProjectId,
  permissions: ProjectPermissions | null,
): PolicyDenyCode | null {
  const policy = evaluatePathRead({
    path,
    project,
    ...(permissions !== null ? { permissions } : {}),
  });
  return policy.allowed ? null : policy.reason;
}

// Gate 1 twice, around gate 2. `evaluatePathRead` is a pure string match
// (`normalizePath` does no fs access), so on the caller's literal path it
// cannot see through a symlink: `ln -s ~/.aws cfg` turns `cfg/credentials`
// into a path that matches no deny glob, while gate 2 only ever checked
// sandbox CONTAINMENT of the realpath — and $HOME is a sandbox root. Re-running
// the denylist on the resolved real path closes that; the first pass stays so a
// denied path is never stat'd and still reports path_denied, not path_unsafe.
function gateAround(
  path: string,
  root: string,
  project: ProjectId,
  permissions: ProjectPermissions | null,
): GateResult {
  const lexical = denyReason(path, project, permissions);
  if (lexical !== null) return { ok: false, code: "path_denied", reason: lexical };

  let resolved: { absolute: string; real: string };
  try {
    resolved = resolveSafeReadPath({ path, projectRoot: root });
  } catch (err) {
    return { ok: false, code: "path_unsafe", message: err instanceof Error ? err.message : "" };
  }

  const structural = denyReason(resolved.real, project, permissions);
  if (structural !== null) return { ok: false, code: "path_denied", reason: structural };
  return { ok: true, absolute: resolved.absolute };
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
  return gateAround(input.path, input.projectRoot, input.projectId, input.permissions);
}

// Overlay variant of runTwoGates: same two gates, keyed by cwd instead of a
// project FK. `evaluatePathRead`'s `project` field is a vestigial label it never
// reads (only `path`/`permissions` drive the verdict), so a placeholder keeps
// the baseline secret-path + deny-glob gate identical to the legacy path.
const OVERLAY_GATE_PROJECT = "overlay" as unknown as ProjectId;

export function runOverlayTwoGates(input: {
  path: string;
  cwd: string;
  permissions: ProjectPermissions | null;
}): GateResult {
  return gateAround(input.path, input.cwd, OVERLAY_GATE_PROJECT, input.permissions);
}

export async function readRaw(
  absolute: string,
): Promise<{ ok: true; raw: string } | { ok: false; message: string }> {
  try {
    return { ok: true, raw: await readFile(absolute, "utf8") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "read failed" };
  }
}

export function filterRaw(input: {
  raw: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes: number | undefined;
  outline?: boolean;
  sessionHints?: SessionHints;
  recordTrace?: boolean;
}): Promise<FilterOutputResult> {
  return filterOutput({
    raw: input.raw,
    intent: input.intent,
    mode: input.mode,
    ...(input.maxReturnedBytes !== undefined ? { maxReturnedBytes: input.maxReturnedBytes } : {}),
    ...(input.outline === true ? { outline: true } : {}),
    ...(input.recordTrace === true ? { recordTrace: true } : {}),
    // Engine ranking rides with the hints: callers that pass no hints keep
    // the pre-seam ranking behavior byte-for-byte. On by default at the seam;
    // MEGASAVER_ENGINE_RANKING=false is the A/B kill switch (§P2.6).
    ...(input.sessionHints !== undefined
      ? { sessionHints: input.sessionHints, engineRanking: !engineRankingDisabledByEnv() }
      : {}),
    source: { kind: "file", path: input.path },
  });
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
  const r = await readRaw(input.absolute);
  if (!r.ok) return r;
  return {
    ok: true,
    raw: r.raw,
    result: await filterRaw({
      raw: r.raw,
      path: input.path,
      intent: input.intent,
      mode: input.mode,
      maxReturnedBytes: input.maxReturnedBytes,
    }),
  };
}

export async function persistChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
  sessionId: SessionId;
  projectId: ProjectId;
  createdAt: string;
  path: string;
  raw: string;
  result: FilterOutputResult;
}): Promise<void> {
  const chunkSet: ChunkSet = {
    chunkSetId: input.chunkSetId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    createdAt: input.createdAt,
    // The file path is secret-bearing (tokens in query-style paths, secret
    // filenames). Redact at this persistence sink so every caller is covered.
    source: { kind: "file", path: redact(input.path).redacted },
    rawBytes: input.result.rawBytes,
    redacted: (input.result.warnings ?? []).some((w) => w.startsWith("redacted")),
    // Outline mode persists its own bodies: they are a whole-file partition, so
    // they already satisfy the A1 contract, and their chunk ids address
    // declarations — the promise mega_fetch_chunk makes in that mode. Every
    // other read recovers from the raw output, NOT from excerpts, which are
    // what survived the fit step (spec §W2).
    chunks:
      input.result.chunks !== undefined
        ? input.result.chunks.map((e, i) => ({
            id: String(i),
            startLine: e.startLine,
            endLine: e.endLine,
            bytes: Buffer.byteLength(e.text, "utf8"),
            text: e.text,
          }))
        : recoverableChunks(input.raw),
  };
  await saveChunkSet({ storeRoot: input.storeRoot, chunkSet });
}

export async function persistOverlayChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
  workspaceKey: string;
  liveSessionId: string;
  createdAt: string;
  path: string;
  raw: string;
  result: FilterOutputResult;
}): Promise<void> {
  const chunkSet: OverlayChunkSet = {
    chunkSetId: input.chunkSetId,
    workspaceKey: input.workspaceKey,
    liveSessionId: input.liveSessionId,
    createdAt: input.createdAt,
    // The file path is secret-bearing (tokens in query-style paths, secret
    // filenames). Redact at this persistence sink so every caller is covered.
    source: { kind: "file", path: redact(input.path).redacted },
    rawBytes: input.result.rawBytes,
    redacted: (input.result.warnings ?? []).some((w) => w.startsWith("redacted")),
    // The overlay path carries no outline bodies (outline is registry-only in
    // v1), so there is nothing to preserve: recover from the raw output.
    chunks: recoverableChunks(input.raw),
  };
  await saveOverlayChunkSet({ storeRoot: input.storeRoot, chunkSet });
}
