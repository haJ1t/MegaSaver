import { type CoreRegistry, type ExecResult, runOutputExecCommand } from "@megasaver/core";
import { rankBm25 } from "@megasaver/retrieval";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

const MAX_BYTES_CEILING = 64_000; // mirrors run-command (AA1 §8a)
const SPAWN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURE_FACTOR = 64;

export type SearchCodeToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  newId: () => string;
  originPid: string;
};

const searchCodeInputSchema = z
  .object({
    query: z.string().min(1),
    task: z.string().optional(),
    sessionId: z.string().min(1),
    path_scope: z.string().optional(),
    max_results: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    include_globs: z.array(z.string()).optional(),
    exclude_globs: z.array(z.string()).optional(),
    context_lines: z.number().int().nonnegative().optional(),
  })
  .strict();

export type SearchCodeMatch = {
  line: number;
  col?: number;
  text: string;
};

export type SearchCodeMatchGroup = {
  path: string;
  matches: SearchCodeMatch[];
};

export type SearchCodeFile = SearchCodeMatchGroup & {
  matchCount: number;
  reason?: string;
};

// "applied" once BM25 re-ranking ran over the live matches; "unavailable"
// when there is nothing to enrich or any enrichment step failed (best-effort,
// never blocks — spec §9.3/§9.5). No persistent index exists, so "stale" is
// not modelled here.
export type IndexEnrichmentStatus = "applied" | "unavailable";

export type SearchCodeResult = {
  query: string;
  files: SearchCodeFile[];
  index_enrichment: IndexEnrichmentStatus;
  chunkSetId: string | undefined;
  metrics: {
    rawBytes: number;
    returnedBytes: number;
    bytesSaved: number;
    savingRatio: number;
    rawTokens: number;
    returnedTokens: number;
  };
  summary: string;
};

// Confine search to the project subtree. path_scope becomes a grep target, so
// an absolute path or a `..` traversal would read files outside the project
// root. Reject both (path-traversal guard) before the command is built.
export function assertSafePathScope(pathScope: string): void {
  const normalized = pathScope.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(normalized)) {
    throw new McpBridgeError(
      "validation_failed",
      `path_scope must be a relative path within the project: ${pathScope}`,
    );
  }
}

// Build a policy-gated `grep` invocation. `rg` is intentionally NOT used: it is
// absent from the LOCKED allowlist (packages/policy ALLOWED_COMMANDS) and may
// not be installed. `-e` guards queries that begin with `-`.
export function buildGrepArgs(input: {
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

// Parse grep `path:line:text` (or `path:line:col:text`) lines into per-file
// groups, preserving first-seen file order. Lines that do not match (blank
// lines, grep `--` separators, context lines with a `-` separator) are skipped.
// Colons inside the matched text are preserved (only the path/line/col prefix
// is consumed).
export function groupGrepMatches(output: string): SearchCodeMatchGroup[] {
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

// Best-effort BM25 re-rank of the grouped files using the query as the BM25
// query over each file's matched-line text. Never adds or removes files — it
// only reorders the live grep result set (spec §9.5). Any failure leaves the
// live grep order untouched and reports "unavailable".
function enrich(
  groups: SearchCodeMatchGroup[],
  query: string,
): { files: SearchCodeMatchGroup[]; status: IndexEnrichmentStatus } {
  if (groups.length === 0) return { files: groups, status: "unavailable" };
  try {
    const documents = groups.map((g) => ({
      id: g.path,
      text: g.matches.map((m) => m.text).join("\n"),
    }));
    const ranked = rankBm25({ query, documents, topN: documents.length });
    const byPath = new Map(groups.map((g) => [g.path, g]));
    const reordered = ranked
      .map((r) => byPath.get(r.id))
      .filter((g): g is SearchCodeMatchGroup => g !== undefined);
    // Defensive: never drop a live match if ranking returned fewer ids.
    if (reordered.length !== groups.length) return { files: groups, status: "unavailable" };
    return { files: reordered, status: "applied" };
  } catch {
    return { files: groups, status: "unavailable" };
  }
}

export async function handleSearchCode(
  env: SearchCodeToolEnv,
  rawArgs: unknown,
): Promise<SearchCodeResult> {
  const parsed = searchCodeInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { query, task, sessionId, max_tokens } = parsed.data;
  if (query.trim() === "") {
    throw new McpBridgeError("validation_failed", "proxy_search_code requires a non-empty query");
  }
  if (max_tokens !== undefined && max_tokens > MAX_BYTES_CEILING) {
    throw new McpBridgeError(
      "max_bytes_exceeded",
      `max_tokens ${max_tokens} exceeds ceiling ${MAX_BYTES_CEILING}`,
    );
  }

  if (parsed.data.path_scope !== undefined) assertSafePathScope(parsed.data.path_scope);

  const grepArgs = buildGrepArgs({
    query,
    pathScope: parsed.data.path_scope ?? ".",
    includeGlobs: parsed.data.include_globs ?? [],
    excludeGlobs: parsed.data.exclude_globs ?? [],
    contextLines: parsed.data.context_lines ?? 0,
  });

  // ponytail: in-process path only. Forwarding to daemon /search requires
  // workspaceKey+liveSessionId (overlay keying) which are absent from this env.
  // The daemon's /search also skips BM25 re-ranking; forwarding would change the
  // tool's output contract (index_enrichment always 'unavailable') without gaining
  // shared-daemon benefits. Defer until env carries overlay keys + store is unified.
  //
  // The orchestrator owns spawn + policy gate + redact + filterOutput +
  // saveChunkSet + stats. The task drives task-aware ranking (intent); fall
  // back to the query when absent.
  const outcome = await runOutputExecCommand({
    registry: env.registry,
    storeRoot: env.storeRoot,
    sessionId: sessionId as Parameters<typeof runOutputExecCommand>[0]["sessionId"],
    command: "grep",
    args: grepArgs,
    intent: task !== undefined && task.trim() !== "" ? task : query,
    originPid: env.originPid,
    timeoutMs: SPAWN_TIMEOUT_MS,
    maxBytes: (max_tokens ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
    now: env.now,
    newId: env.newId,
  });

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "session_not_found":
        throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
      case "policy_load_failed":
        throw new McpBridgeError("policy_load_failed", `policy load failed: ${outcome.detail}`, {
          details: { reason: outcome.detail },
        });
      case "command_denied":
        throw new McpBridgeError("command_denied", `command denied: ${outcome.code}`, {
          details: { reason: outcome.code },
        });
      case "command_failed":
        throw new McpBridgeError("tool_invocation_failed", outcome.detail, {
          cause: new Error(outcome.detail),
        });
      case "store_write_failed":
        throw new McpBridgeError("store_write_failed", outcome.detail);
    }
  }

  return shapeResult(query, outcome.result);
}

function shapeResult(query: string, exec: ExecResult): SearchCodeResult {
  const liveOutput = exec.excerpts.map((e) => e.text).join("\n");
  const groups = groupGrepMatches(liveOutput);
  const { files: ordered, status } = enrich(groups, query);
  const files: SearchCodeFile[] = ordered.map((g) => ({
    ...g,
    matchCount: g.matches.length,
    reason: `${g.matches.length} match(es)`,
  }));
  return {
    query,
    files,
    index_enrichment: status,
    chunkSetId: exec.chunkSetId,
    metrics: {
      rawBytes: exec.rawBytes,
      returnedBytes: exec.returnedBytes,
      bytesSaved: exec.bytesSaved,
      savingRatio: exec.savingRatio,
      rawTokens: exec.rawTokens,
      returnedTokens: exec.returnedTokens,
    },
    summary: exec.summary,
  };
}
