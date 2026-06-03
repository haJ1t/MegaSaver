import type { FilterOutputResult } from "@megasaver/output-filter";
import type { SessionId } from "@megasaver/shared";
import {
  type LoadProjectPermissions,
  defaultNewId,
  defaultNow,
  persistChunkSet,
  readAndFilter,
  resolveEffectiveSettings,
  runTwoGates,
} from "./read.js";
import type { OrchestratorRegistry } from "./registry-port.js";

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
  | { ok: false; reason: "file_read_failed"; detail: string };

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

  const result = { ...filtered.result };
  if (settings.storeRawOutput) {
    const chunkSetId = (input.newId ?? defaultNewId)();
    await persistChunkSet({
      storeRoot: input.storeRoot,
      chunkSetId,
      sessionId: input.sessionId,
      projectId: settings.projectId,
      createdAt: (input.now ?? defaultNow)(),
      path: input.path,
      result: filtered.result,
    });
    result.chunkSetId = chunkSetId;
  }

  return { ok: true, result };
}
