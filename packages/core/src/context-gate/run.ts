import type { FilterOutputResult } from "@megasaver/output-filter";
import type { SessionId } from "@megasaver/shared";
import type { CoreRegistry } from "../registry.js";
import {
  defaultNewId,
  defaultNow,
  persistChunkSet,
  readAndFilter,
  resolveEffectiveSettings,
  runTwoGates,
} from "./read.js";

export type RunOutputInput = {
  registry: CoreRegistry;
  storeRoot: string;
  sessionId: SessionId;
  path: string;
  intent: string;
  now?: () => string;
  newId?: () => string;
};

export type RunOutputResult =
  | { ok: true; result: FilterOutputResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "path_denied"; detail: string }
  | { ok: false; reason: "path_unsafe"; detail: string }
  | { ok: false; reason: "file_read_failed"; detail: string };

export async function runOutputPipeline(input: RunOutputInput): Promise<RunOutputResult> {
  const settings = resolveEffectiveSettings(input.registry, input.sessionId);
  if (settings === null) return { ok: false, reason: "session_not_found" };

  const gate = runTwoGates({
    path: input.path,
    projectId: settings.projectId,
    projectRoot: settings.projectRoot,
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
