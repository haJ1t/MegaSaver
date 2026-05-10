import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CorePersistenceError,
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  type Session,
  memoryEntrySchema,
  memoryScopeSchema,
} from "@megasaver/core";
import {
  type ProjectId,
  type SessionId,
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { z } from "zod";
import { BRIDGE_ERROR_CODES, type BridgeErrorCode } from "../src/bridge-error-code.js";

export interface BridgeHandlerOptions {
  registry: CoreRegistry;
  /** Override for tests; defaults to `crypto.randomUUID`. */
  newId?: () => string;
  /** Override for tests; defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** Resolved store directory; surfaced on `GET /api/health`. */
  storePath?: string;
}

export type BridgeHandler = (req: IncomingMessage, res: ServerResponse) => void;

// Title schema mirrors apps/cli/src/commands/session/shared.ts (NFC + control-char
// ban). Held local here so the bridge does not depend on `@megasaver/cli`.
const TITLE_SCHEMA = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f\u2028\u2029]+$/)
  .transform((value) => value.normalize("NFC"));

const CREATE_SESSION_BODY = z
  .object({
    projectId: projectIdSchema,
    agentId: agentIdSchema,
    title: TITLE_SCHEMA.optional(),
    riskLevel: riskLevelSchema.optional().default("medium"),
  })
  .strict();

const END_SESSION_BODY = z
  .object({
    endedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// PATCH body — subset of sessionUpdatePatchSchema (cannot import via cross-file
// because we need a tweaked title check that allows null and empty-string-as-null).
const PATCH_SESSION_BODY = z
  .object({
    title: TITLE_SCHEMA.nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must contain at least one field",
  });

const CREATE_MEMORY_BODY = z
  .object({
    projectId: projectIdSchema,
    content: z.string().trim().min(1),
    scope: memoryScopeSchema,
    sessionId: sessionIdSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.scope === "session" && entry.sessionId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Session-scoped memory requires sessionId.",
        path: ["sessionId"],
      });
    }
    if (entry.scope === "project" && entry.sessionId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Project-scoped memory cannot include sessionId.",
        path: ["sessionId"],
      });
    }
  });

const ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

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

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: { [key: string]: string; vary: string } = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "origin",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: BridgeErrorCode,
  message: string,
  origin: string | undefined,
  details?: unknown,
): void {
  const body: { error: string; code: BridgeErrorCode; details?: unknown } = {
    error: message,
    code,
  };
  if (details !== undefined) {
    body.details = details;
  }
  sendJson(res, status, body, origin);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// Map a CoreRegistryError code to a BridgeErrorCode + status. The Core enum
// includes codes that bridge does not surface (project_already_exists,
// session_already_exists, memory_entry_already_exists, memory_entry_not_found):
// these never originate from the bridge's request handlers because the bridge
// generates ids and never re-creates known entities. They fall through to
// internal_error if encountered.
function mapCoreRegistryError(err: CoreRegistryError): {
  status: number;
  code: BridgeErrorCode;
} | null {
  switch (err.code) {
    case "project_not_found":
      return { status: 404, code: "project_not_found" };
    case "session_not_found":
      return { status: 404, code: "session_not_found" };
    case "session_already_ended":
      return { status: 409, code: "session_already_ended" };
    case "session_project_mismatch":
      return { status: 409, code: "session_project_mismatch" };
    default:
      return null;
  }
}

function handleCaughtError(res: ServerResponse, origin: string | undefined, err: unknown): void {
  if (err instanceof CoreRegistryError) {
    const mapped = mapCoreRegistryError(err);
    if (mapped) {
      sendError(res, mapped.status, mapped.code, err.message, origin);
      return;
    }
  }
  if (err instanceof CorePersistenceError) {
    sendError(res, 500, "store_write_failed", err.message, origin);
    return;
  }
  // Heuristic: mirror the Node fs ErrnoException shape (EPERM / ENOENT / etc.)
  // as store_write_failed since the handler only reaches this branch on writes.
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string") {
    const errno = (err as NodeJS.ErrnoException).code as string;
    if (errno.startsWith("E")) {
      sendError(res, 500, "store_write_failed", err.message, origin);
      return;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  sendError(res, 500, "internal_error", message, origin);
}

function zodErrorMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : "Validation failed.";
}

function ensureProject(registry: CoreRegistry, projectId: ProjectId): boolean {
  return registry.getProject(projectId) !== null;
}

export function createBridgeHandler(opts: BridgeHandlerOptions): BridgeHandler {
  const { registry } = opts;
  const newId = opts.newId ?? randomUUID;
  const now = opts.now ?? (() => new Date().toISOString());
  const storePath = opts.storePath ?? "";

  return (req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      // Last-ditch safety net so a thrown handler never leaves a hanging socket.
      try {
        handleCaughtError(res, undefined, err);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        }
        res.end();
      }
    });
  };

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const originHeader = req.headers.origin;
    let origin: string | undefined;
    if (typeof originHeader === "string" && originHeader.length > 0) {
      if (!ALLOWED_ORIGINS.includes(originHeader)) {
        sendError(
          res,
          403,
          "origin_forbidden",
          "Request blocked by the bridge origin policy.",
          undefined,
        );
        return;
      }
      origin = originHeader;
    }

    const { method, path, query } = parseUrl(req);

    if (method === "OPTIONS") {
      const headers: { [key: string]: string } = origin
        ? {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
            "access-control-allow-headers": "content-type",
            vary: "origin",
          }
        : {};
      res.writeHead(204, headers);
      res.end();
      return;
    }

    // GET /api/health
    if (path === "/api/health") {
      if (method !== "GET") {
        sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
        return;
      }
      sendJson(res, 200, { ok: true, store: storePath }, origin);
      return;
    }

    // GET /api/projects
    if (path === "/api/projects") {
      if (method !== "GET") {
        sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
        return;
      }
      try {
        const projects = registry
          .listProjects()
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        sendJson(res, 200, projects, origin);
      } catch (err) {
        handleCaughtError(res, origin, err);
      }
      return;
    }

    // GET /api/sessions, POST /api/sessions
    if (path === "/api/sessions") {
      if (method === "GET") {
        try {
          const projectIdRaw = query.get("projectId");
          let sessions: Session[];
          if (projectIdRaw === null) {
            sessions = registry
              .listProjects()
              .flatMap((project) => registry.listSessions(project.id));
          } else {
            const parsed = projectIdSchema.safeParse(projectIdRaw);
            if (!parsed.success) {
              sendError(
                res,
                400,
                "validation_failed",
                zodErrorMessage(parsed.error),
                origin,
                parsed.error.issues,
              );
              return;
            }
            if (!ensureProject(registry, parsed.data)) {
              sendError(res, 404, "project_not_found", `Project not found: ${parsed.data}`, origin);
              return;
            }
            sessions = registry.listSessions(parsed.data);
          }
          sessions = sessions.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
          sendJson(res, 200, sessions, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "validation_failed", "Invalid JSON body.", origin);
          return;
        }
        const parsed = CREATE_SESSION_BODY.safeParse(body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "validation_failed",
            zodErrorMessage(parsed.error),
            origin,
            parsed.error.issues,
          );
          return;
        }
        if (!ensureProject(registry, parsed.data.projectId)) {
          sendError(
            res,
            404,
            "project_not_found",
            `Project not found: ${parsed.data.projectId}`,
            origin,
          );
          return;
        }
        try {
          const sessionId = sessionIdSchema.parse(newId());
          const created = registry.createSession({
            id: sessionId,
            projectId: parsed.data.projectId,
            agentId: parsed.data.agentId,
            riskLevel: parsed.data.riskLevel,
            title: parsed.data.title ?? null,
            startedAt: now(),
            endedAt: null,
          });
          sendJson(res, 201, created, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
      return;
    }

    // /api/sessions/:id and /api/sessions/:id/end
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/end)?$/);
    if (sessionMatch) {
      const idRaw = sessionMatch[1] as string;
      const isEnd = sessionMatch[2] === "/end";
      const idParse = sessionIdSchema.safeParse(idRaw);

      if (isEnd) {
        if (method !== "POST") {
          sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
          return;
        }
        if (!idParse.success) {
          sendError(res, 404, "session_not_found", `Session not found: ${idRaw}`, origin);
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "validation_failed", "Invalid JSON body.", origin);
          return;
        }
        const parsed = END_SESSION_BODY.safeParse(body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "validation_failed",
            zodErrorMessage(parsed.error),
            origin,
            parsed.error.issues,
          );
          return;
        }
        try {
          const ended = registry.endSession(idParse.data, {
            endedAt: parsed.data.endedAt ?? now(),
          });
          sendJson(res, 200, ended, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      if (method === "PATCH") {
        if (!idParse.success) {
          sendError(res, 404, "session_not_found", `Session not found: ${idRaw}`, origin);
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "validation_failed", "Invalid JSON body.", origin);
          return;
        }
        const parsed = PATCH_SESSION_BODY.safeParse(body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "validation_failed",
            zodErrorMessage(parsed.error),
            origin,
            parsed.error.issues,
          );
          return;
        }
        const patch: { title?: string | null; riskLevel?: string; agentId?: string } = {};
        if (parsed.data.title !== undefined) patch.title = parsed.data.title;
        if (parsed.data.riskLevel !== undefined) patch.riskLevel = parsed.data.riskLevel;
        if (parsed.data.agentId !== undefined) patch.agentId = parsed.data.agentId;
        try {
          const updated = registry.updateSession(
            idParse.data,
            patch as Parameters<CoreRegistry["updateSession"]>[1],
          );
          sendJson(res, 200, updated, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
      return;
    }

    // GET /api/memory, POST /api/memory
    if (path === "/api/memory") {
      if (method === "GET") {
        try {
          const projectIdRaw = query.get("projectId");
          let entries: MemoryEntry[];
          if (projectIdRaw === null) {
            entries = registry
              .listProjects()
              .flatMap((project) => registry.listMemoryEntries(project.id));
          } else {
            const parsed = projectIdSchema.safeParse(projectIdRaw);
            if (!parsed.success) {
              sendError(
                res,
                400,
                "validation_failed",
                zodErrorMessage(parsed.error),
                origin,
                parsed.error.issues,
              );
              return;
            }
            if (!ensureProject(registry, parsed.data)) {
              sendError(res, 404, "project_not_found", `Project not found: ${parsed.data}`, origin);
              return;
            }
            entries = registry.listMemoryEntries(parsed.data);
          }
          entries = entries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          sendJson(res, 200, entries, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendError(res, 400, "validation_failed", "Invalid JSON body.", origin);
          return;
        }
        const parsed = CREATE_MEMORY_BODY.safeParse(body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "validation_failed",
            zodErrorMessage(parsed.error),
            origin,
            parsed.error.issues,
          );
          return;
        }
        if (!ensureProject(registry, parsed.data.projectId)) {
          sendError(
            res,
            404,
            "project_not_found",
            `Project not found: ${parsed.data.projectId}`,
            origin,
          );
          return;
        }
        // Pre-flight: session must exist and be open before delegating to Core,
        // so we can surface session_already_ended distinctly. Core only emits
        // session_project_mismatch and session_not_found from createMemoryEntry.
        let resolvedSessionId: SessionId | null = null;
        if (parsed.data.scope === "session" && parsed.data.sessionId !== undefined) {
          const session = registry.getSession(parsed.data.sessionId);
          if (!session) {
            sendError(
              res,
              404,
              "session_not_found",
              `Session not found: ${parsed.data.sessionId}`,
              origin,
            );
            return;
          }
          if (session.endedAt !== null) {
            sendError(
              res,
              409,
              "session_already_ended",
              `Session already ended: ${parsed.data.sessionId}`,
              origin,
            );
            return;
          }
          resolvedSessionId = parsed.data.sessionId;
        }
        try {
          const entryId = newId();
          const entry = memoryEntrySchema.parse({
            id: entryId,
            projectId: parsed.data.projectId,
            sessionId: resolvedSessionId,
            scope: parsed.data.scope,
            content: parsed.data.content,
            createdAt: now(),
          });
          const created = registry.createMemoryEntry(entry);
          sendJson(res, 201, created, origin);
        } catch (err) {
          handleCaughtError(res, origin, err);
        }
        return;
      }

      sendError(res, 405, "method_not_allowed", `Method ${method} not allowed.`, origin);
      return;
    }

    sendError(res, 404, "route_not_found", `Route not found: ${method} ${path}`, origin);
  }
}

// Re-export so production server (server.ts) and tests get a single source of truth.
export { BRIDGE_ERROR_CODES };
export type { BridgeErrorCode };
