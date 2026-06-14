import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreRegistry } from "@megasaver/core";
import type { McpSetupOps } from "@megasaver/mcp-bridge";
import { BRIDGE_ERROR_CODES, type BridgeErrorCode } from "../src/bridge-error-code.js";
import { applyCorsPolicy, handleOptionsPreflight } from "./cors.js";
import { handleCaughtError } from "./error-mapping.js";
import type { RouteContext, SendError, SendJson, SendText } from "./route-context.js";
import { handleGetHealth } from "./routes/health.js";
import { dispatchMcpSetup } from "./routes/mcp-setup.js";
import {
  handleDeleteMemory,
  handleGetMemory,
  handlePatchMemory,
  handlePostMemory,
} from "./routes/memory.js";
import { dispatchProjectScoped } from "./routes/project-scoped.js";
import { handleGetProjects, handlePostProject } from "./routes/projects.js";
import { dispatchRetention } from "./routes/retention.js";
import {
  handleEndSession,
  handleGetSessions,
  handlePatchSession,
  handlePostSession,
} from "./routes/sessions.js";
import { dispatchTokenSaver } from "./routes/token-saver.js";

export interface BridgeHandlerOptions {
  registry: CoreRegistry;
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
  const { registry } = opts;
  const newId = opts.newId ?? randomUUID;
  const now = opts.now ?? (() => new Date().toISOString());
  const storePath = opts.storePath ?? "";

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
      registry,
      mcpOps,
      origin,
      query,
      storeRoot: storePath,
      newId,
      now,
      sendJson,
      sendError,
      sendText,
    };

    if (path === "/api/health") {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      handleGetHealth(ctx, storePath);
      return;
    }

    if (path === "/api/projects") {
      if (method === "GET") {
        handleGetProjects(ctx);
        return;
      }
      if (method === "POST") {
        await handlePostProject(ctx);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    if (path.startsWith("/api/projects/")) {
      const dispatched = dispatchProjectScoped(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path === "/api/sessions") {
      if (method === "GET") {
        handleGetSessions(ctx);
        return;
      }
      if (method === "POST") {
        await handlePostSession(ctx);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/end)?$/);
    if (sessionMatch) {
      const idRaw = sessionMatch[1] as string;
      const isEnd = sessionMatch[2] === "/end";
      if (isEnd) {
        if (method !== "POST") return methodNotAllowed(res, method, origin);
        await handleEndSession(ctx, idRaw);
        return;
      }
      if (method === "PATCH") {
        await handlePatchSession(ctx, idRaw);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    if (path.startsWith("/api/sessions/") && path.includes("/token-saver")) {
      const dispatched = await dispatchTokenSaver(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path.startsWith("/api/sessions/") && path.includes("/retention")) {
      const dispatched = await dispatchRetention(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path.startsWith("/api/mcp/")) {
      const dispatched = await dispatchMcpSetup(ctx, method, path, () =>
        methodNotAllowed(res, method, origin),
      );
      if (dispatched) return;
    }

    if (path === "/api/memory") {
      if (method === "GET") {
        handleGetMemory(ctx);
        return;
      }
      if (method === "POST") {
        await handlePostMemory(ctx);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    const memoryMatch = path.match(/^\/api\/memory\/([^/]+)$/);
    if (memoryMatch) {
      const idRaw = memoryMatch[1] as string;
      if (method === "PATCH") {
        await handlePatchMemory(ctx, idRaw);
        return;
      }
      if (method === "DELETE") {
        await handleDeleteMemory(ctx, idRaw);
        return;
      }
      return methodNotAllowed(res, method, origin);
    }

    sendError(res, 404, "route_not_found", `Route not found: ${method} ${path}`, origin);
  }
}
// Re-export so production server (server.ts) and tests share one source of truth.
export { BRIDGE_ERROR_CODES };
export type { BridgeErrorCode };
