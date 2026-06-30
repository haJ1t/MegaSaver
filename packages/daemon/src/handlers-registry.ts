import { listChunkSets } from "@megasaver/content-store";
import {
  type RunCommandSpawn,
  fetchChunk,
  runOutputExecCommand,
  runOutputPipeline,
} from "@megasaver/context-gate";
import { createJsonDirectoryCoreRegistry, isRecallable, isSafeKeySegment } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { z } from "zod";
import type { HandlerResponse } from "./handlers.js";

// ponytail: safeSegmentSchema duplicated from handlers.ts — no abstraction until
// a third handler file needs it.
const safeSegmentSchema = z.string().min(1).refine(isSafeKeySegment);

// ─── constants (mirrors handlers.ts) ──────────────────────────────────────────

const MAX_BYTES_CEILING = 64_000;
const SPAWN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURE_FACTOR = 64;

// ─── expandRegistryHandler ────────────────────────────────────────────────────
// Serves proxy_expand_chunk for registry-keyed chunk sets.
// ponytail invariant: NO allowedChunkSetIds guard here — the per-response
// expansion guard (fetch-chunk.ts:38) MUST run in-process in the tool before
// forwarding (5b). Daemon expanding any chunkSetId for any caller would leak
// across sessions.

const expandRegistryRequestSchema = z
  .object({
    chunkSetId: safeSegmentSchema,
    chunkId: safeSegmentSchema,
  })
  .strict();

export async function expandRegistryHandler(
  storeRoot: string,
  body: unknown,
): Promise<HandlerResponse> {
  const parsed = expandRegistryRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const res = await fetchChunk({ storeRoot, ...parsed.data });
  if (res.ok) return { status: 200, json: { chunk: res.chunk } };
  if (res.reason === "store_corrupt") return { status: 500, json: { error: res.reason } };
  return { status: 404, json: { error: res.reason } };
}

// ─── recallRegistryHandler ────────────────────────────────────────────────────
// Serves proxy_recall for registry-keyed sessions.

const recallRegistryRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    intent: z.string().min(1),
    // Bi-temporal time-travel (M1): recall what we believed as of this instant.
    // Absent ⇒ now ⇒ currently-valid memories only. Must be accepted here so a
    // forwarded asOf from recall.ts round-trips instead of 400→silent fallback.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function recallRegistryHandler(
  storeRoot: string,
  body: unknown,
): Promise<HandlerResponse> {
  const parsed = recallRegistryRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });
  const session = registry.getSession(parsed.data.sessionId);
  if (session === null) return { status: 404, json: { error: "session_not_found" } };

  const asOf = parsed.data.asOf ?? new Date().toISOString();
  const allMemory = registry.listMemoryEntries(session.projectId);
  const memory = allMemory.filter(
    (m) => isRecallable(m, asOf) && (m.sessionId === session.id || m.scope === "project"),
  );

  const chunkSets = await listChunkSets({
    storeRoot,
    projectId: session.projectId,
    sessionId: session.id,
  });

  return { status: 200, json: { memory, chunkSets } };
}

// ─── deps type (shared by exec + read) ───────────────────────────────────────

export type RegistryHandlerDeps = {
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
};

// ─── execRegistryHandler ─────────────────────────────────────────────────────
// Serves proxy_run_command (and proxy_search_code via grep args) for
// registry-keyed sessions.

const execRegistryRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    command: z.string().min(1),
    args: z.array(z.string()),
    intent: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  })
  .strict();

export async function execRegistryHandler(
  storeRoot: string,
  body: unknown,
  deps?: RegistryHandlerDeps,
): Promise<HandlerResponse> {
  const parsed = execRegistryRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const { maxBytes } = parsed.data;
  if (maxBytes !== undefined && maxBytes > MAX_BYTES_CEILING) {
    return {
      status: 400,
      json: { error: `maxBytes ${maxBytes} exceeds ceiling ${MAX_BYTES_CEILING}` },
    };
  }

  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });

  const result = await runOutputExecCommand({
    registry,
    storeRoot,
    sessionId: parsed.data.sessionId,
    command: parsed.data.command,
    args: parsed.data.args,
    intent: parsed.data.intent,
    originPid: String(process.pid),
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBytes: (maxBytes ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
    ...(deps?.spawn !== undefined ? { spawn: deps.spawn } : {}),
    ...(deps?.now !== undefined ? { now: deps.now } : {}),
    ...(deps?.newId !== undefined ? { newId: deps.newId } : {}),
  });

  if (!result.ok) {
    switch (result.reason) {
      case "command_denied":
        return { status: 400, json: { error: "command_denied", code: result.code } };
      case "policy_load_failed":
        return { status: 400, json: { error: result.reason, detail: result.detail } };
      case "session_not_found":
        return { status: 404, json: { error: result.reason } };
      case "command_failed":
        return { status: 502, json: { error: result.reason, detail: result.detail } };
      case "store_write_failed":
        return { status: 500, json: { error: result.reason, detail: result.detail } };
    }
  }

  return { status: 200, json: { ...result.result } };
}

// ─── readRegistryHandler ──────────────────────────────────────────────────────
// Serves proxy_read_file for registry-keyed sessions.

const readRegistryRequestSchema = z
  .object({
    sessionId: sessionIdSchema,
    path: z.string().min(1),
    intent: z.string().min(1),
    outline: z.boolean().optional(),
  })
  .strict();

export async function readRegistryHandler(
  storeRoot: string,
  body: unknown,
  deps?: Pick<RegistryHandlerDeps, "now" | "newId">,
): Promise<HandlerResponse> {
  const parsed = readRegistryRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });

  const result = await runOutputPipeline({
    registry,
    storeRoot,
    sessionId: parsed.data.sessionId,
    path: parsed.data.path,
    intent: parsed.data.intent,
    ...(parsed.data.outline === true ? { outline: true } : {}),
    ...(deps?.now !== undefined ? { now: deps.now } : {}),
    ...(deps?.newId !== undefined ? { newId: deps.newId } : {}),
  });

  if (!result.ok) {
    switch (result.reason) {
      case "session_not_found":
        return { status: 404, json: { error: result.reason } };
      case "policy_load_failed":
        return { status: 400, json: { error: result.reason, detail: result.detail } };
      case "path_denied":
        return { status: 400, json: { error: result.reason, detail: result.detail } };
      case "path_unsafe":
        return { status: 400, json: { error: result.reason, detail: result.detail } };
      case "file_read_failed":
        return { status: 502, json: { error: result.reason, detail: result.detail } };
      case "store_write_failed":
        return { status: 500, json: { error: result.reason, detail: result.detail } };
    }
  }

  return { status: 200, json: { ...result.result } };
}
