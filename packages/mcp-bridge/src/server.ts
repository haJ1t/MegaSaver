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
import { handleFetchChunk } from "./tools/fetch-chunk.js";
import { handleReadFile } from "./tools/read-file.js";
import { handleRecall } from "./tools/recall.js";
import { handleRunCommand } from "./tools/run-command.js";

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
};

// Internal dispatch id (== legacy wire name) + description. The
// exposed name is derived per naming mode at list/dispatch time.
const TOOL_DEFS: ReadonlyArray<{ id: McpToolName; description: string }> = [
  { id: "mega_fetch_chunk", description: "Fetch one stored chunk from a chunk set." },
  { id: "mega_read_file", description: "Read a file through the redact/filter pipeline." },
  { id: "mega_recall", description: "Recall session memory and stored chunk sets." },
  { id: "mega_run_command", description: "Run a policy-gated command and filter its output." },
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
    }
  }

  const transport = (deps.transportFactory ?? (() => new StdioServerTransport()))();
  return { server, transport };
}
