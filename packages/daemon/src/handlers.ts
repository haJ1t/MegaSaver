import {
  type RunCommandSpawn,
  fetchOverlayChunk,
  loadProjectPermissions,
  recordAndFilterOverlayOutput,
  runOverlayOutputExecCommand,
} from "@megasaver/context-gate";
import { isSafeKeySegment, liveSessionIdSchema, workspaceKeySchema } from "@megasaver/core";
import { outputSourceKindSchema } from "@megasaver/output-filter";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export type HandlerResponse = { status: number; json: Record<string, unknown> };

// workspaceKey/liveSessionId/chunk ids become filesystem path segments downstream
// (stats dir + overlay chunk store), so a ".." value would escape the store root.
// Reject containment-breaking segments at the trust boundary, before any write.
const safeSegmentSchema = z.string().min(1).refine(isSafeKeySegment);

const excerptRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    raw: z.string(),
    sourceKind: outputSourceKindSchema,
    label: z.string(),
    mode: tokenSaverModeSchema,
    storeRawOutput: z.boolean(),
  })
  .strict();

export async function excerptHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = excerptRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const result = await recordAndFilterOverlayOutput({ storeRoot, ...parsed.data });
  return { status: 200, json: { ...result } };
}

const expandRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    chunkSetId: safeSegmentSchema,
    chunkId: safeSegmentSchema,
  })
  .strict();

export async function expandHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = expandRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const res = await fetchOverlayChunk({ storeRoot, ...parsed.data });
  if (res.ok) return { status: 200, json: { chunk: res.chunk } };
  if (res.reason === "store_corrupt") return { status: 500, json: { error: res.reason } };
  return { status: 404, json: { error: res.reason } };
}

// ─── exec constants ───────────────────────────────────────────────────────────

const MAX_BYTES_CEILING = 64_000; // mirrors mcp-bridge search-code (AA1 §8a)
const SPAWN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURE_FACTOR = 64;

// ─── execHandler ─────────────────────────────────────────────────────────────

const execRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    cwd: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    intent: z.string().min(1),
    mode: tokenSaverModeSchema,
    maxReturnedBytes: z.number().int().positive().optional(),
    storeRawOutput: z.boolean(),
  })
  .strict();

export type ExecHandlerDeps = { spawn?: RunCommandSpawn; now?: () => string; newId?: () => string };

export async function execHandler(
  storeRoot: string,
  body: unknown,
  deps?: ExecHandlerDeps,
): Promise<HandlerResponse> {
  const parsed = execRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const { maxReturnedBytes } = parsed.data;
  if (maxReturnedBytes !== undefined && maxReturnedBytes > MAX_BYTES_CEILING) {
    return {
      status: 400,
      json: { error: `maxReturnedBytes ${maxReturnedBytes} exceeds ceiling ${MAX_BYTES_CEILING}` },
    };
  }

  // Fail-closed: load permissions before any spawn; a bad yaml → 400, no spawn.
  let permissions: ReturnType<typeof loadProjectPermissions>;
  try {
    permissions = loadProjectPermissions(parsed.data.cwd);
  } catch (e) {
    return { status: 400, json: { error: e instanceof Error ? e.message : String(e) } };
  }

  const result = await runOverlayOutputExecCommand({
    storeRoot,
    ...parsed.data,
    permissions,
    originPid: String(process.pid),
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBytes: (maxReturnedBytes ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
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
      case "command_failed":
        return { status: 502, json: { error: result.reason, detail: result.detail } };
      case "store_write_failed":
        return { status: 500, json: { error: result.reason, detail: result.detail } };
      case "session_not_found":
        // Cannot occur on the overlay path (no registry), but handle exhaustively.
        return { status: 500, json: { error: result.reason } };
    }
  }

  return { status: 200, json: { ...result.result } };
}

// ─── search helpers (copied from mcp-bridge/search-code.ts — NOT imported) ──
// ponytail: two copies until a later phase extracts to @megasaver/shared.
// Dependency inversion: daemon must not depend on mcp-bridge (it will become
// a daemon client); copy the ~40 LOC pure helpers instead.

/** Reject absolute paths and '..' traversals in a grep path_scope argument. */
function isSafePathScope(pathScope: string): boolean {
  const normalized = pathScope.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !/(^|\/)\.\.(\/|$)/.test(normalized);
}

function buildGrepArgs(input: {
  query: string;
  pathScope: string;
  includeGlobs: readonly string[];
  excludeGlobs: readonly string[];
  contextLines: number;
}): string[] {
  const args = ["-r", "-n"];
  for (const glob of input.includeGlobs) args.push(`--include=${glob}`);
  for (const glob of input.excludeGlobs) args.push(`--exclude=${glob}`);
  if (input.contextLines > 0) args.push("-C", String(input.contextLines));
  args.push("-e", input.query, input.pathScope);
  return args;
}

const MATCH_LINE = /^(.+?):(\d+):(?:(\d+):)?(.*)$/;

type SearchCodeMatch = { line: number; col?: number; text: string };
type SearchCodeMatchGroup = { path: string; matches: SearchCodeMatch[] };

function groupGrepMatches(output: string): SearchCodeMatchGroup[] {
  const byPath = new Map<string, SearchCodeMatchGroup>();
  const order: string[] = [];
  for (const rawLine of output.split("\n")) {
    const m = MATCH_LINE.exec(rawLine);
    if (m === null) continue;
    const path = m[1] as string;
    const line = Number.parseInt(m[2] as string, 10);
    const colRaw = m[3];
    const text = m[4] as string;
    let group = byPath.get(path);
    if (group === undefined) {
      group = { path, matches: [] };
      byPath.set(path, group);
      order.push(path);
    }
    const match: SearchCodeMatch =
      colRaw !== undefined ? { line, col: Number.parseInt(colRaw, 10), text } : { line, text };
    group.matches.push(match);
  }
  return order.map((p) => byPath.get(p) as SearchCodeMatchGroup);
}

// ─── searchHandler ────────────────────────────────────────────────────────────

const searchRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    liveSessionId: liveSessionIdSchema,
    cwd: z.string().min(1),
    query: z.string().min(1),
    intent: z.string().min(1),
    path_scope: z.string().optional(),
    include_globs: z.array(z.string()).optional(),
    exclude_globs: z.array(z.string()).optional(),
    context_lines: z.number().int().nonnegative().optional(),
    max_tokens: z.number().int().positive().optional(),
  })
  .strict();

export type SearchHandlerDeps = {
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
};

export async function searchHandler(
  storeRoot: string,
  body: unknown,
  deps?: SearchHandlerDeps,
): Promise<HandlerResponse> {
  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };

  const { path_scope, max_tokens } = parsed.data;

  // path_scope becomes a grep argument — guard traversal before building args.
  if (path_scope !== undefined && !isSafePathScope(path_scope)) {
    return {
      status: 400,
      json: { error: `path_scope must be a relative path within the project: ${path_scope}` },
    };
  }

  if (max_tokens !== undefined && max_tokens > MAX_BYTES_CEILING) {
    return {
      status: 400,
      json: { error: `max_tokens ${max_tokens} exceeds ceiling ${MAX_BYTES_CEILING}` },
    };
  }

  // Fail-closed: load permissions before any spawn.
  let permissions: ReturnType<typeof loadProjectPermissions>;
  try {
    permissions = loadProjectPermissions(parsed.data.cwd);
  } catch (e) {
    return { status: 400, json: { error: e instanceof Error ? e.message : String(e) } };
  }

  const grepArgs = buildGrepArgs({
    query: parsed.data.query,
    pathScope: path_scope ?? ".",
    includeGlobs: parsed.data.include_globs ?? [],
    excludeGlobs: parsed.data.exclude_globs ?? [],
    contextLines: parsed.data.context_lines ?? 0,
  });

  const result = await runOverlayOutputExecCommand({
    storeRoot,
    workspaceKey: parsed.data.workspaceKey,
    liveSessionId: parsed.data.liveSessionId,
    cwd: parsed.data.cwd,
    command: "grep",
    args: grepArgs,
    intent: parsed.data.intent,
    mode: "aggressive",
    ...(max_tokens !== undefined ? { maxReturnedBytes: max_tokens } : {}),
    storeRawOutput: true,
    permissions,
    originPid: String(process.pid),
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBytes: (max_tokens ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
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
      case "command_failed":
        return { status: 502, json: { error: result.reason, detail: result.detail } };
      case "store_write_failed":
        return { status: 500, json: { error: result.reason, detail: result.detail } };
      case "session_not_found":
        return { status: 500, json: { error: result.reason } };
    }
  }

  const liveOutput = result.result.excerpts.map((e) => e.text).join("\n");
  const groups = groupGrepMatches(liveOutput);
  // ponytail: skip BM25 re-rank (needs @megasaver/retrieval) — add when search relevance is poor.
  const files = groups.map((g) => ({
    ...g,
    matchCount: g.matches.length,
    reason: `${g.matches.length} match(es)`,
  }));

  return {
    status: 200,
    json: {
      query: parsed.data.query,
      files,
      chunkSetId: result.result.chunkSetId,
      metrics: {
        rawBytes: result.result.rawBytes,
        returnedBytes: result.result.returnedBytes,
        bytesSaved: result.result.bytesSaved,
        savingRatio: result.result.savingRatio,
        rawTokens: result.result.rawTokens,
        returnedTokens: result.result.returnedTokens,
      },
      summary: result.result.summary,
    },
  };
}
