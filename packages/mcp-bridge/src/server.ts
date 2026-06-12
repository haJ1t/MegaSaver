import { randomUUID } from "node:crypto";
import type { CoreRegistry } from "@megasaver/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpBridgeError } from "./errors.js";
import { mcpToolNameSchema } from "./tool-name.js";
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
import { handleGetApplicableRules } from "./tools/get-applicable-rules.js";
import { handleGetRelevantMemories } from "./tools/get-relevant-memories.js";
import { handleGetProjectContext } from "./tools/project-context.js";
import { handleGetProjectRules, handleSaveProjectRule } from "./tools/project-rules.js";
import { handleReadFile } from "./tools/read-file.js";
import { handleRecall } from "./tools/recall.js";
import { handleRunCommand } from "./tools/run-command.js";
import { handleSaveMemory } from "./tools/save-memory.js";
import { handleSearchMemory } from "./tools/search-memory.js";

export type ServerDeps = {
  registry: CoreRegistry;
  storeRoot: string;
  now?: () => string;
  newId?: () => string;
  // Injectable so the bridge lifecycle test never attaches a real
  // readline to process.stdin under Vitest (CRITICAL §12). Production
  // defaults to a real StdioServerTransport.
  transportFactory?: () => StdioServerTransport;
};

const TOOL_DEFS = [
  {
    name: "convert_failure_to_rule",
    description: "Convert a failed attempt into a reusable project rule.",
  },
  {
    name: "explain_context_selection",
    description: "Per-factor scoring for each included context block.",
  },
  { name: "find_similar_failures", description: "Rank past failed attempts similar to a task." },
  {
    name: "get_applicable_rules",
    description: "Score project rules applicable to a task or files.",
  },
  {
    name: "get_context_budget_report",
    description: "Token-savings audit for a task's context pack.",
  },
  {
    name: "get_project_context",
    description: "Project briefing: meta, rules, key memories, index summary, open failures.",
  },
  {
    name: "get_project_rules",
    description: "Reusable project rules, optionally filtered by task or files.",
  },
  {
    name: "get_relevant_code_blocks",
    description: "The included blocks of a task's context pack.",
  },
  {
    name: "get_relevant_context",
    description: "Build a task-aware context pack from the project index.",
  },
  { name: "get_relevant_memories", description: "Rank project memories by relevance to a task." },
  { name: "mega_fetch_chunk", description: "Fetch one stored chunk from a chunk set." },
  { name: "mega_read_file", description: "Read a file through the redact/filter pipeline." },
  { name: "mega_recall", description: "Recall session memory and stored chunk sets." },
  { name: "mega_run_command", description: "Run a policy-gated command and filter its output." },
  { name: "record_failed_attempt", description: "Record a failed task attempt for a project." },
  { name: "save_memory", description: "Write a typed memory entry to a project." },
  { name: "save_project_rule", description: "Write a reusable project rule." },
  { name: "search_memory", description: "Search project memories by text and filters." },
] as const;

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
  const originPid = resolveOriginPid();
  const server = new Server(
    { name: "megasaver", version: "0.5.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: TOOL_DEFS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { type: "object" as const },
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    const parsedName = mcpToolNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw wireError(new McpBridgeError("tool_not_found", `unknown tool: ${name}`));
    }
    try {
      const payload = await dispatch(parsedName.data, args);
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

  function dispatch(toolName: ReturnType<typeof mcpToolNameSchema.parse>, args: unknown) {
    switch (toolName) {
      case "mega_fetch_chunk":
        return handleFetchChunk({ storeRoot: deps.storeRoot }, args);
      case "mega_read_file":
        return handleReadFile(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId },
          args,
        );
      case "mega_recall":
        return handleRecall({ registry: deps.registry, storeRoot: deps.storeRoot }, args);
      case "mega_run_command":
        return handleRunCommand(
          { registry: deps.registry, storeRoot: deps.storeRoot, now, newId, originPid },
          args,
        );
      case "save_memory":
        return handleSaveMemory({ registry: deps.registry, now, newId }, args);
      case "search_memory":
        return handleSearchMemory({ registry: deps.registry }, args);
      case "get_relevant_memories":
        return handleGetRelevantMemories({ registry: deps.registry }, args);
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
      case "get_project_context":
        return handleGetProjectContext(
          { registry: deps.registry, storeRoot: deps.storeRoot },
          args,
        );
      case "get_project_rules":
        return handleGetProjectRules({ registry: deps.registry }, args);
      case "record_failed_attempt":
        return handleRecordFailedAttempt({ registry: deps.registry, now, newId }, args);
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
