import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveClaudeCodeSettingsPath } from "@megasaver/connector-claude-code";
import type { McpSetupOps } from "@megasaver/mcp-bridge";
import { BRIDGE_ERROR_CODES, type BridgeErrorCode } from "../src/bridge-error-code.js";
import { applyCorsPolicy, handleOptionsPreflight } from "./cors.js";
import { handleCaughtError } from "./error-mapping.js";
import type {
  OfficeContext,
  RouteContext,
  SendError,
  SendJson,
  SendText,
} from "./route-context.js";
import { dispatchClaudeHooks } from "./routes/claude-hooks.js";
import {
  handleDeleteSessionMemory,
  handleGetSessionMemory,
  handlePatchSessionMemory,
  handlePostSessionMemory,
} from "./routes/claude-session-memory.js";
import { handleGetSessionTasks } from "./routes/claude-session-tasks.js";
import { dispatchSessionTokenSaver } from "./routes/claude-session-token-saver.js";
import {
  handleGetClaudeSession,
  handleGetClaudeSessionTelemetry,
  handleListClaudeSessions,
  handleStreamClaudeSession,
} from "./routes/claude-sessions.js";
import { handleGetHealth } from "./routes/health.js";
import { dispatchMcpSetup } from "./routes/mcp-setup.js";
import { handleGetMemoryGraph } from "./routes/memory-graph.js";
import {
  handleControlAgent,
  handleCreateAgent,
  handleCreateRole,
  handleCreateTask,
  handleDeleteAgent,
  handleDeleteRole,
  handleListAgents,
  handleListAudit,
  handleListRoles,
  handleListTasks,
  handleOfficeStatus,
  handleOfficeStream,
  handleRunAgent,
} from "./routes/office.js";
import { dispatchWorkspaceScoped } from "./routes/workspace-scoped.js";
import { handleListWorkspaces } from "./routes/workspaces.js";
import { resolveWorkspace } from "./workspace-resolver.js";

export interface BridgeHandlerOptions {
  /** Override for tests; defaults to `crypto.randomUUID`. */
  newId?: () => string;
  /** Override for tests; defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** Resolved store directory; surfaced on `GET /api/health`. */
  storePath?: string;
  /** F3: production McpSetupOps; BB11 routes consume it via RouteContext.
   *  Production server.ts passes buildMcpSetupOps(...); omitted only in tests
   *  that exercise non-mcp routes (then an empty-status fallback is used). */
  mcpOps?: McpSetupOps;
  /** Override for tests; defaults to ~/.claude/projects. */
  claudeProjectsDir?: string;
  /** Override for tests; defaults to the desktop app's claude-code-sessions dir. */
  claudeSessionsMetaDir?: string;
  /** Override for tests; defaults to ~/.claude/settings.json. */
  claudeSettingsPath?: string;
  /** Office supervisor deps. Populated by production server.ts; injected in tests. */
  office?: OfficeContext;
}

export type BridgeHandler = (req: IncomingMessage, res: ServerResponse) => void;

type ParsedRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
};

function parseUrl(req: IncomingMessage): ParsedRequest {
  const url = new URL(req.url ?? "/", "http://localhost");
  return {
    method: req.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
  };
}

const sendJson: SendJson = (res, status, body, origin) => {
  const headers: { [key: string]: string; vary: string } = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // Defence-in-depth: bridge serves JSON only, but lock cross-origin
    // resources down in case a future endpoint ever emits HTML.
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
};

const sendText: SendText = (res, status, body, origin) => {
  const headers: { [key: string]: string; vary: string } = {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": "inline",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  res.writeHead(status, headers);
  res.end(body);
};

const sendError: SendError = (res, status, code, message, origin, details) => {
  const body: { error: string; code: BridgeErrorCode; details?: unknown } = {
    error: message,
    code,
  };
  if (details !== undefined) {
    body.details = details;
  }
  sendJson(res, status, body, origin);
};

function methodNotAllowed(res: ServerResponse, method: string, origin: string | undefined): void {
  sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
}

export function createBridgeHandler(opts: BridgeHandlerOptions): BridgeHandler {
  const newId = opts.newId ?? randomUUID;
  const now = opts.now ?? (() => new Date().toISOString());
  const storePath = opts.storePath ?? "";
  const claudeProjectsDir = opts.claudeProjectsDir ?? join(homedir(), ".claude", "projects");
  // macOS desktop app location; tests inject their own dir. Other platforms that
  // store this elsewhere simply yield no titles (the list then comes back empty).
  const claudeSessionsMetaDir =
    opts.claudeSessionsMetaDir ??
    join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions");
  const claudeSettingsPath = opts.claudeSettingsPath ?? resolveClaudeCodeSettingsPath();

  // Test-only fallback when no ops injected; production server.ts (BB8)
  // always passes buildMcpSetupOps(...). Reports an empty agent list so
  // non-mcp route tests that omit mcpOps still construct a valid handler.
  const mcpOps: McpSetupOps =
    opts.mcpOps ??
    ({
      status: async () => ({ agents: [] }),
      install: async () => ({ agents: [] }),
      repair: async () => ({ agents: [] }),
      uninstall: async () => ({ agents: [] }),
    } satisfies McpSetupOps);

  return (req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      // Last-ditch safety net so a thrown handler never leaves a hanging socket.
      try {
        handleCaughtError(res, undefined, err, sendError);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        }
        res.end();
      }
    });
  };

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = applyCorsPolicy(req, res, sendError);
    if (!cors.allowed) return;
    const { origin } = cors;

    const { method, path, query } = parseUrl(req);

    if (method === "OPTIONS") {
      handleOptionsPreflight(res, origin);
      return;
    }

    const ctx: RouteContext = {
      req,
      res,
      mcpOps,
      origin,
      query,
      storeRoot: storePath,
      claudeProjectsDir,
      claudeSessionsMetaDir,
      claudeSettingsPath,
      resolveWorkspace,
      newId,
      now,
      sendJson,
      sendError,
      sendText,
      ...(opts.office !== undefined ? { office: opts.office } : {}),
    };

    if (path === "/api/health") {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      handleGetHealth(ctx, storePath);
      return;
    }

    if (path.startsWith("/api/mcp/")) {
      const dispatched = await dispatchMcpSetup(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path === "/api/hooks/claude-code") {
      const dispatched = await dispatchClaudeHooks(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path === "/api/claude-sessions") {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleListClaudeSessions(ctx);
      return;
    }

    if (path === "/api/workspaces") {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleListWorkspaces(ctx);
      return;
    }

    if (path.startsWith("/api/workspaces/")) {
      const dispatched = await dispatchWorkspaceScoped(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    const memoryGraphMatch = path.match(
      /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/memory\/graph$/,
    );
    if (memoryGraphMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      const dir = decodeURIComponent(memoryGraphMatch[1] as string);
      const id = decodeURIComponent(memoryGraphMatch[2] as string);
      await handleGetMemoryGraph(ctx, dir, id);
      return;
    }

    const claudeMemoryMatch = path.match(
      /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/memory(?:\/([^/]+))?$/,
    );
    if (claudeMemoryMatch) {
      const dir = decodeURIComponent(claudeMemoryMatch[1] as string);
      const id = decodeURIComponent(claudeMemoryMatch[2] as string);
      const entryId = claudeMemoryMatch[3];
      if (entryId === undefined) {
        if (method === "GET") {
          await handleGetSessionMemory(ctx, dir, id);
          return;
        }
        if (method === "POST") {
          await handlePostSessionMemory(ctx, dir, id);
          return;
        }
        return methodNotAllowed(res, method, origin);
      }
      const decodedEntryId = decodeURIComponent(entryId);
      if (method === "PATCH") {
        await handlePatchSessionMemory(ctx, dir, id, decodedEntryId);
        return;
      }
      if (method === "DELETE") {
        await handleDeleteSessionMemory(ctx, dir, id, decodedEntryId);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    if (path.startsWith("/api/claude-sessions/") && path.includes("/token-saver")) {
      const dispatched = await dispatchSessionTokenSaver(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    const claudeTasksMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/tasks$/);
    if (claudeTasksMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      const dir = decodeURIComponent(claudeTasksMatch[1] as string);
      const id = decodeURIComponent(claudeTasksMatch[2] as string);
      await handleGetSessionTasks(ctx, dir, id);
      return;
    }

    const claudeMatch = path.match(
      /^\/api\/claude-sessions\/([^/]+)\/([^/]+?)(\/stream|\/telemetry)?$/,
    );
    if (claudeMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      const dir = decodeURIComponent(claudeMatch[1] as string);
      const id = decodeURIComponent(claudeMatch[2] as string);
      if (claudeMatch[3] === "/stream") {
        await handleStreamClaudeSession(ctx, dir, id);
      } else if (claudeMatch[3] === "/telemetry") {
        await handleGetClaudeSessionTelemetry(ctx, dir, id);
      } else {
        await handleGetClaudeSession(ctx, dir, id);
      }
      return;
    }

    // Office routes — /api/office/*
    // Roles (global)
    if (path === "/api/office/roles") {
      if (method === "GET") {
        await handleListRoles(ctx);
        return;
      }
      if (method === "POST") {
        await handleCreateRole(ctx);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }
    const officeRoleMatch = path.match(/^\/api\/office\/roles\/([^/]+)$/);
    if (officeRoleMatch) {
      if (method !== "DELETE") return methodNotAllowed(res, method, origin);
      await handleDeleteRole(ctx, decodeURIComponent(officeRoleMatch[1] as string));
      return;
    }

    // Agents (workspace-scoped)
    const officeAgentsMatch = path.match(/^\/api\/office\/([^/]+)\/agents$/);
    if (officeAgentsMatch) {
      const wk = decodeURIComponent(officeAgentsMatch[1] as string);
      if (method === "GET") {
        await handleListAgents(ctx, wk);
        return;
      }
      if (method === "POST") {
        await handleCreateAgent(ctx, wk);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }
    const officeAgentMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)$/);
    if (officeAgentMatch) {
      const wk = decodeURIComponent(officeAgentMatch[1] as string);
      const agentId = decodeURIComponent(officeAgentMatch[2] as string);
      if (method !== "DELETE") return methodNotAllowed(res, method, origin);
      await handleDeleteAgent(ctx, wk, agentId);
      return;
    }

    // Tasks
    const officeTasksMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/tasks$/);
    if (officeTasksMatch) {
      const wk = decodeURIComponent(officeTasksMatch[1] as string);
      const agentId = decodeURIComponent(officeTasksMatch[2] as string);
      if (method === "GET") {
        await handleListTasks(ctx, wk, agentId);
        return;
      }
      if (method === "POST") {
        await handleCreateTask(ctx, wk, agentId);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    // Run
    const officeRunMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/run$/);
    if (officeRunMatch) {
      if (method !== "POST") return methodNotAllowed(res, method, origin);
      const wk = decodeURIComponent(officeRunMatch[1] as string);
      const agentId = decodeURIComponent(officeRunMatch[2] as string);
      await handleRunAgent(ctx, wk, agentId);
      return;
    }

    // Control
    const officeControlMatch = path.match(/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/control$/);
    if (officeControlMatch) {
      if (method !== "POST") return methodNotAllowed(res, method, origin);
      const wk = decodeURIComponent(officeControlMatch[1] as string);
      const agentId = decodeURIComponent(officeControlMatch[2] as string);
      await handleControlAgent(ctx, wk, agentId);
      return;
    }

    // Audit / status / stream
    const officeAuditMatch = path.match(/^\/api\/office\/([^/]+)\/audit$/);
    if (officeAuditMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleListAudit(ctx, decodeURIComponent(officeAuditMatch[1] as string));
      return;
    }
    const officeStatusMatch = path.match(/^\/api\/office\/([^/]+)\/status$/);
    if (officeStatusMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleOfficeStatus(ctx, decodeURIComponent(officeStatusMatch[1] as string));
      return;
    }
    const officeStreamMatch = path.match(/^\/api\/office\/([^/]+)\/stream$/);
    if (officeStreamMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleOfficeStream(ctx, decodeURIComponent(officeStreamMatch[1] as string));
      return;
    }

    sendError(res, 404, "route_not_found", `Route not found: ${method} ${path}`, origin);
  }
}
// Re-export so production server (server.ts) and tests share one source of truth.
export { BRIDGE_ERROR_CODES };
export type { BridgeErrorCode };
