import { randomUUID } from "node:crypto";
import type { CoreRegistry } from "@megasaver/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpBridgeError } from "./errors.js";
import type { McpToolName } from "./tool-name.js";
import {
  type NamingMode,
  exposedToolName,
  internalIdFromExposed,
  namingModeFromEnv,
} from "./tool-naming.js";
import { handleApproveMemory } from "./tools/approve-memory.js";
import { handleAuditTokenUsage } from "./tools/audit-token-usage.js";
import { handleBuildTaskPlan } from "./tools/build-task-plan.js";
import {
  handleExplainContextSelection,
  handleGetContextBudgetReport,
  handleGetRelevantCodeBlocks,
  handleGetRelevantContext,
} from "./tools/context-pruning.js";
import { handleConvertFailureToRule } from "./tools/convert-failure-to-rule.js";
import { handleRecordFailedAttempt } from "./tools/failed-attempts.js";
import { handleFetchChunk } from "./tools/fetch-chunk.js";
import { handleFindSimilarFailures } from "./tools/find-similar-failures.js";
import { handleFromSessionMemory } from "./tools/from-session-memory.js";
import { handleGetApplicableRules } from "./tools/get-applicable-rules.js";
import { handleGetEditImpact } from "./tools/get-edit-impact.js";
import { handleGetRelevantMemories } from "./tools/get-relevant-memories.js";
import { handleGetTaskContext } from "./tools/get-task-context.js";
import { handleGetTaskStatus } from "./tools/get-task-status.js";
import { handleImpact } from "./tools/impact.js";
import { handleIndexMemory } from "./tools/index-memory.js";
import { handleGetProjectContext } from "./tools/project-context.js";
import { handleGetProjectRules, handleSaveProjectRule } from "./tools/project-rules.js";
import { handleReadFile } from "./tools/read-file.js";
import { handleRecall } from "./tools/recall.js";
import { handleRecordTaskStep } from "./tools/record-task-step.js";
import { handleRetryFailedStep } from "./tools/retry-failed-step.js";
import { handleRouteToolsForTask } from "./tools/route-tools-for-task.js";
import { handleRunCommand } from "./tools/run-command.js";
import { handleSaveMemory } from "./tools/save-memory.js";
import { handleSearchCode } from "./tools/search-code.js";
import { handleSearchMemory } from "./tools/search-memory.js";
import { handleSweepMemory } from "./tools/sweep-memory.js";

// Maximum number of chunkSetIds the server-owned expansion-guard set may hold.
// Evicts the oldest entry (FIFO) when the cap is exceeded so a long-lived
// server process can't grow unbounded (contextgate-honest-90 §11).
// Per-session keying is deferred: sessionId is not carried in mega_fetch_chunk
// args (only chunkSetId + chunkId), so we cannot key by session without a
// breaking contract change on the expand wire. stdio MCP is single-session-per-
// process in practice, so this per-server cap is sufficient for now.
export const EXPANSION_GUARD_CAP = 4096;

// FIFO-bounded Set. Exceeding cap evicts the oldest element.
// Exported for unit tests only — not part of the public package API.
export class BoundedSet {
  readonly #cap: number;
  readonly #order: string[] = [];
  readonly #set = new Set<string>();

  constructor(cap: number) {
    this.#cap = cap;
  }

  add(id: string): void {
    if (this.#set.has(id)) return;
    if (this.#order.length >= this.#cap) {
      const evicted = this.#order.shift();
      if (evicted !== undefined) this.#set.delete(evicted);
    }
    this.#order.push(id);
    this.#set.add(id);
  }

  has(id: string): boolean {
    return this.#set.has(id);
  }

  // Returns a read-only view of the underlying Set for use as ReadonlySet<string>.
  asReadonlySet(): ReadonlySet<string> {
    return this.#set;
  }
}

export type ServerDeps = {
  registry: CoreRegistry;
  storeRoot: string;
  now?: () => string;
  newId?: () => string;
  // Public tool naming mode (Proxy Mode v1.2 §5). Injectable for
  // tests; production resolves from MEGASAVER_TOOL_NAMING once at
  // startup, defaulting to proxy.
  toolNaming?: NamingMode;
  // Injectable so the bridge lifecycle test never attaches a real
  // readline to process.stdin under Vitest (CRITICAL §12). Production
  // defaults to a real StdioServerTransport.
  transportFactory?: () => StdioServerTransport;
  // Explicit override of the chunk set ids the agent may expand in this server
  // instance (tests/CLI). When absent, buildServer falls back to a server-owned
  // set populated from the chunk sets it actually returned this session, so the
  // expansion guard is always engaged on the production path.
  allowedChunkSetIds?: ReadonlySet<string>;
};

// Internal dispatch id (== legacy wire name) + description. The
// exposed name is derived per naming mode at list/dispatch time.
const TOOL_DEFS: ReadonlyArray<{ id: McpToolName; description: string }> = [
  {
    id: "approve_memory",
    description:
      "Approve or reject a suggested memory entry (human-in-the-loop decision; cannot move a memory back to suggested).",
  },
  {
    id: "audit_token_usage",
    description: "Summarize recorded token/context savings for a project or session.",
  },
  { id: "build_task_plan", description: "Create an ordered, dependency-aware task plan." },
  {
    id: "convert_failure_to_rule",
    description: "Convert a failed attempt into a reusable project rule.",
  },
  {
    id: "explain_context_selection",
    description: "Per-factor scoring for each included context block.",
  },
  { id: "find_similar_failures", description: "Rank past failed attempts similar to a task." },
  {
    id: "get_applicable_rules",
    description: "Score project rules applicable to a task or files.",
  },
  {
    id: "get_context_budget_report",
    description: "Token-savings audit for a task's context pack.",
  },
  {
    id: "get_edit_impact",
    description:
      "Diff-driven blast radius: impacted callers and suggested test files for the changed files (explicit list or git diff).",
  },
  {
    id: "get_project_context",
    description: "Project briefing: meta, rules, key memories, index summary, open failures.",
  },
  {
    id: "get_project_rules",
    description: "Reusable project rules, optionally filtered by task or files.",
  },
  {
    id: "get_relevant_code_blocks",
    description: "The included blocks of a task's context pack.",
  },
  {
    id: "get_relevant_context",
    description: "Build a task-aware context pack from the project index.",
  },
  { id: "get_relevant_memories", description: "Rank project memories by relevance to a task." },
  {
    id: "get_task_context",
    description: "Build a task-aware context pack from the project index and memories.",
  },
  { id: "get_task_status", description: "Plan status, per-step state, and ready steps." },
  { id: "mega_fetch_chunk", description: "Fetch one stored chunk from a chunk set." },
  {
    id: "mega_impact",
    description:
      "Reverse call-graph blast radius: given a symbol, return it plus every transitive caller affected by changing it. Prefer this over grepping for 'who calls this' — the closure is exhaustive within budget.",
  },
  {
    id: "mega_index_memory",
    description:
      "Build/refresh the semantic memory-vector index for a project so get_relevant_memories ranks by meaning. On-demand (loads the embedding model); run after adding/approving memories.",
  },
  {
    id: "mega_memory_from_session",
    description:
      "Deterministically distill a session's recorded failures into SUGGESTED memories for the human approval gate (no LLM). Never auto-approves; suggested memories are not recallable until approved. Idempotent — re-running stages no duplicates.",
  },
  {
    id: "mega_memory_sweep",
    description:
      "Archive aged-out/low-value memories (demote to the archival tier so they drop out of default recall). On-demand and lossless — never deletes; idempotent. Run periodically to keep recall focused on the working/recall set.",
  },
  { id: "mega_read_file", description: "Read a file through the redact/filter pipeline." },
  { id: "mega_recall", description: "Recall session memory and stored chunk sets." },
  { id: "mega_run_command", description: "Run a policy-gated command and filter its output." },
  {
    id: "proxy_search_code",
    description:
      "Task-aware code search. Prefer this over native grep/search: it groups matches by file, compresses noisy output, stores the raw results for expansion, and reports token savings.",
  },
  { id: "record_failed_attempt", description: "Record a failed task attempt for a project." },
  {
    id: "record_task_step",
    description: "Report a step running/completed/failed; rolls up plan status.",
  },
  {
    id: "retry_failed_step",
    description: "Reset a failed step (and its dependents) to pending.",
  },
  {
    id: "route_tools_for_task",
    description: "Recommend task-relevant tools; block dangerous/deploy/database.",
  },
  { id: "save_memory", description: "Write a typed memory entry to a project." },
  { id: "save_project_rule", description: "Write a reusable project rule." },
  { id: "search_memory", description: "Search project memories by text and filters." },
];

// The MCP SDK serialises only `error.message` into the JSON-RPC
// error envelope a client receives. AA1 §14 BB8 acceptance requires
// the client to observe the McpBridgeErrorCode (tool_not_found,
// command_denied, …), so the wire message is prefixed with the code.
// The code/details/name fields are preserved for in-process callers.
function wireError(err: McpBridgeError): McpBridgeError {
  const prefixed = err.message.startsWith(err.code) ? err.message : `${err.code}: ${err.message}`;
  return new McpBridgeError(err.code, prefixed, {
    ...(err.cause !== undefined ? { cause: err.cause } : {}),
    ...(err.details !== undefined ? { details: err.details } : {}),
  });
}

function resolveOriginPid(): string {
  // AA1 §8d step 3: inherit MEGASAVER_ORIGIN_PID if present (this
  // bridge is downstream of MegaSaver); otherwise this process is
  // the root and owns the marker.
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const inherited = process.env["MEGASAVER_ORIGIN_PID"];
  return inherited !== undefined && inherited !== "" ? inherited : String(process.pid);
}

export function buildServer(deps: ServerDeps): {
  server: Server;
  transport: StdioServerTransport;
} {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => randomUUID());
  const naming = deps.toolNaming ?? namingModeFromEnv();
  const originPid = resolveOriginPid();

  // Chunk sets this server has actually returned this session. The expansion
  // guard (fetch-chunk) only allows ids in here, so an agent cannot expand an
  // arbitrary chunk set it never received (contextgate-honest-90 §11). Bounded
  // at EXPANSION_GUARD_CAP entries (FIFO eviction) so a long-lived server
  // never grows unbounded. An explicit deps.allowedChunkSetIds (tests/CLI)
  // overrides this server-owned set entirely.
  const returnedChunkSetIds = new BoundedSet(EXPANSION_GUARD_CAP);
  const recordChunkSetId = <T extends { chunkSetId?: string | undefined }>(result: T): T => {
    if (result.chunkSetId !== undefined) returnedChunkSetIds.add(result.chunkSetId);
    return result;
  };
  const server = new Server(
    { name: "megasaver", version: "0.5.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: TOOL_DEFS.map((t) => ({
        name: exposedToolName(t.id, naming),
        description: t.description,
        inputSchema: { type: "object" as const },
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    const internalId = internalIdFromExposed(name, naming);
    if (internalId === undefined) {
      throw wireError(new McpBridgeError("tool_not_found", `unknown tool: ${name}`));
    }
    try {
      const payload = await dispatch(internalId, args);
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    } catch (err) {
      if (err instanceof McpBridgeError) throw wireError(err);
      throw wireError(
        new McpBridgeError(
          "tool_invocation_failed",
          err instanceof Error ? err.message : "tool failed",
          { cause: err },
        ),
      );
    }
  });

  function dispatch(toolName: McpToolName, args: unknown) {
    switch (toolName) {
      case "approve_memory":
        return handleApproveMemory(
          { registry: deps.registry, storeRoot: deps.storeRoot, now },
          args,
        );
      case "audit_token_usage":
        return handleAuditTokenUsage(
          { registry: deps.registry, storeRoot: deps.storeRoot, now },
          args,
        );
      case "build_task_plan":
        return handleBuildTaskPlan({ registry: deps.registry, now, newId }, args);
      case "mega_fetch_chunk":
        return handleFetchChunk(
          {
            storeRoot: deps.storeRoot,
            allowedChunkSetIds: deps.allowedChunkSetIds ?? returnedChunkSetIds.asReadonlySet(),
          },
          args,
        );
      case "mega_read_file":
        return handleReadFile(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId },
          args,
        ).then(recordChunkSetId);
      case "mega_impact":
        return handleImpact({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "mega_index_memory":
        return handleIndexMemory({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "mega_memory_from_session":
        return handleFromSessionMemory({ registry: deps.registry, now, newId }, args);
      case "mega_memory_sweep":
        return handleSweepMemory({ registry: deps.registry }, args);
      case "mega_recall":
        return handleRecall({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "mega_run_command":
        return handleRunCommand(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId, originPid },
          args,
        ).then(recordChunkSetId);
      case "proxy_search_code":
        return handleSearchCode(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId, originPid },
          args,
        ).then(recordChunkSetId);
      case "save_memory":
        return handleSaveMemory({ registry: deps.registry, now, newId }, args);
      case "search_memory":
        return handleSearchMemory({ registry: deps.registry }, args);
      case "get_relevant_memories":
        return handleGetRelevantMemories(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_task_status":
        return handleGetTaskStatus({ registry: deps.registry }, args);
      case "get_relevant_context":
        return handleGetRelevantContext(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_relevant_code_blocks":
        return handleGetRelevantCodeBlocks(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "explain_context_selection":
        return handleExplainContextSelection(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_context_budget_report":
        return handleGetContextBudgetReport(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_task_context":
        return handleGetTaskContext({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "get_edit_impact":
        return handleGetEditImpact({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "get_project_context":
        return handleGetProjectContext(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_project_rules":
        return handleGetProjectRules({ registry: deps.registry }, args);
      case "record_failed_attempt":
        return handleRecordFailedAttempt({ registry: deps.registry, now, newId }, args);
      case "record_task_step":
        return handleRecordTaskStep({ registry: deps.registry, now, newId }, args);
      case "retry_failed_step":
        return handleRetryFailedStep({ registry: deps.registry }, args);
      case "route_tools_for_task":
        return handleRouteToolsForTask({ registry: deps.registry }, args);
      case "save_project_rule":
        return handleSaveProjectRule({ registry: deps.registry, now, newId }, args);
      case "convert_failure_to_rule":
        return handleConvertFailureToRule({ registry: deps.registry, now, newId }, args);
      case "find_similar_failures":
        return handleFindSimilarFailures({ registry: deps.registry }, args);
      case "get_applicable_rules":
        return handleGetApplicableRules({ registry: deps.registry }, args);
    }
  }

  const transport = (deps.transportFactory ?? (() => new StdioServerTransport()))();
  return { server, transport };
}
