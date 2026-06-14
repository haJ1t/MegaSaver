import type { FilterOutputResult } from "@megasaver/output-filter";
import type { ProjectPermissions } from "@megasaver/policy";
import type { SessionId, TokenSaverMode } from "@megasaver/shared";
import {
  type OverlayTokenSaverEvent,
  type TokenSaverEvent,
  appendEvent,
  appendOverlayEvent,
} from "@megasaver/stats";
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  persistChunkSet,
  persistOverlayChunkSet,
  readAndFilter,
  resolveEffectiveSettings,
  resolveOverlayEffectiveSettings,
  runOverlayTwoGates,
  runTwoGates,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";
import { messageOf, redactedCount } from "./stats-helpers.js";

export type RunOutputInput = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  sessionId: SessionId;
  path: string;
  intent: string;
  now?: () => string;
  newId?: () => string;
  // Injectable project-permissions loader (default = real fs+yaml loader) so
  // tests drive absent/valid/throwing without a real file (permissions-yaml §5.2).
  loadPermissions?: LoadProjectPermissions;
};

export type RunOutputResult =
  | { ok: true; result: FilterOutputResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string }
  | { ok: false; reason: "path_denied"; detail: string }
  | { ok: false; reason: "path_unsafe"; detail: string }
  | { ok: false; reason: "file_read_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };

export async function runOutputPipeline(input: RunOutputInput): Promise<RunOutputResult> {
  const resolved = resolveEffectiveSettings(input.registry, input.sessionId, input.loadPermissions);
  // Fail-closed (I3): a present-but-malformed permissions.yaml denies the read
  // here, before runTwoGates / fs.readFile — the gate is shut before IO.
  if (!resolved.ok) {
    return resolved.reason === "policy_load_failed"
      ? { ok: false, reason: "policy_load_failed", detail: resolved.detail }
      : { ok: false, reason: "session_not_found" };
  }
  const { settings } = resolved;

  const gate = runTwoGates({
    path: input.path,
    projectId: settings.projectId,
    projectRoot: settings.projectRoot,
    permissions: settings.permissions,
  });
  if (!gate.ok) {
    return gate.code === "path_denied"
      ? { ok: false, reason: "path_denied", detail: gate.reason }
      : { ok: false, reason: "path_unsafe", detail: gate.message };
  }

  const filtered = await readAndFilter({
    absolute: gate.absolute,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
  });
  if (!filtered.ok) return { ok: false, reason: "file_read_failed", detail: filtered.message };

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  const result = { ...filtered.result };
  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    try {
      await persistChunkSet({
        storeRoot: input.storeRoot,
        chunkSetId,
        sessionId: input.sessionId,
        projectId: settings.projectId,
        createdAt: now(),
        path: input.path,
        result: filtered.result,
      });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
  }

  const event: TokenSaverEvent = {
    id: newId(),
    sessionId: input.sessionId,
    projectId: settings.projectId,
    createdAt: now(),
    sourceKind: "file",
    label: input.path,
    rawBytes: filtered.result.rawBytes,
    returnedBytes: filtered.result.returnedBytes,
    bytesSaved: filtered.result.bytesSaved,
    savingRatio: filtered.result.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.result.summary,
    mode: settings.mode,
  };
  try {
    appendEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted: redactedCount(filtered.result.warnings ?? []),
      chunksStored: filtered.result.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}

// F4 live-first variant: keyed by (workspaceKey, liveSessionId, cwd) with
// caller-resolved token-saver settings — no registry/session lookup. Events and
// chunk-sets land under the overlay keys (architecture §6.1).
export type RunOverlayOutputInput = {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  cwd: string;
  path: string;
  intent: string;
  mode: TokenSaverMode;
  maxReturnedBytes?: number | undefined;
  storeRawOutput: boolean;
  permissions: ProjectPermissions | null;
  now?: () => string;
  newId?: () => string;
};

export async function runOverlayOutputPipeline(
  input: RunOverlayOutputInput,
): Promise<RunOutputResult> {
  const settings = resolveOverlayEffectiveSettings({
    cwd: input.cwd,
    permissions: input.permissions,
    mode: input.mode,
    maxReturnedBytes: input.maxReturnedBytes,
    storeRawOutput: input.storeRawOutput,
  });

  const gate = runOverlayTwoGates({
    path: input.path,
    cwd: settings.cwd,
    permissions: settings.permissions,
  });
  if (!gate.ok) {
    return gate.code === "path_denied"
      ? { ok: false, reason: "path_denied", detail: gate.reason }
      : { ok: false, reason: "path_unsafe", detail: gate.message };
  }

  const filtered = await readAndFilter({
    absolute: gate.absolute,
    path: input.path,
    intent: input.intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
  });
  if (!filtered.ok) return { ok: false, reason: "file_read_failed", detail: filtered.message };

  const now = input.now ?? defaultNow;
  const newId = input.newId ?? defaultNewId;

  const result = { ...filtered.result };
  if (settings.storeRawOutput) {
    const chunkSetId = newId();
    try {
      await persistOverlayChunkSet({
        storeRoot: input.storeRoot,
        chunkSetId,
        workspaceKey: input.workspaceKey,
        liveSessionId: input.liveSessionId,
        createdAt: now(),
        path: input.path,
        result: filtered.result,
      });
    } catch (err) {
      return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
    }
    result.chunkSetId = chunkSetId;
  }

  const event: OverlayTokenSaverEvent = {
    id: newId(),
    workspaceKey: input.workspaceKey,
    liveSessionId: input.liveSessionId,
    createdAt: now(),
    sourceKind: "file",
    label: input.path,
    rawBytes: filtered.result.rawBytes,
    returnedBytes: filtered.result.returnedBytes,
    bytesSaved: filtered.result.bytesSaved,
    savingRatio: filtered.result.savingRatio,
    ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
    summary: filtered.result.summary,
    mode: settings.mode,
  };
  try {
    appendOverlayEvent({
      store: { root: input.storeRoot },
      event,
      secretsRedacted: redactedCount(filtered.result.warnings ?? []),
      chunksStored: filtered.result.excerpts.length,
    });
  } catch (err) {
    return { ok: false, reason: "store_write_failed", detail: messageOf(err) };
  }

  return { ok: true, result };
}
