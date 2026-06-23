import { watch } from "node:fs";
import { join } from "node:path";
import {
  AgentOfficeError,
  OFFICE_PROJECT_ID,
  appendTranscript,
  createSupervisor,
  deleteAgent,
  deleteRole,
  ensureOfficeProject,
  listAgents,
  listAudit,
  listRoles,
  listTasks,
  listTranscript,
  loadAgent,
  loadRole,
  officeAgentSchema,
  officeTaskSchema,
  roleSchema,
  saveAgent,
  saveRole,
  saveTask,
  transcriptEntrySchema,
} from "@megasaver/agent-office";
import type { OfficeAgent } from "@megasaver/agent-office";
import type { CoreRegistry } from "@megasaver/core";
import {
  type WorkspaceKey,
  encodeWorkspaceKey,
  officeAgentIdSchema,
  roleIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { handleCaughtError } from "../error-mapping.js";
import { publishTranscript, subscribeTranscript, transcriptKey } from "../office-transcript-bus.js";
import {
  agentCreateInputSchema,
  chatInputSchema,
  controlInputSchema,
  roleCreateInputSchema,
  taskCreateInputSchema,
} from "../office-validation.js";
import type { RouteContext } from "../route-context.js";
import { zodErrorMessage } from "../zod-schemas.js";
import { readJsonBody } from "./_body.js";

// Re-export so existing bridge consumers (tests, server bootstrap) keep working
// without an import change — the canonical definitions live in @megasaver/agent-office.
export { OFFICE_PROJECT_ID, ensureOfficeProject };

// Map AgentOfficeError codes to HTTP status + BridgeErrorCode.
// Exported for unit tests covering each mapping arm.
export function mapOfficeError(err: AgentOfficeError): {
  status: number;
  code: "office_not_found" | "validation_failed" | "internal_error";
} {
  switch (err.code) {
    case "not_found":
      return { status: 404, code: "office_not_found" };
    case "schema_invalid":
    case "permission_denied":
      return { status: 400, code: "validation_failed" };
    default:
      return { status: 500, code: "internal_error" };
  }
}

function handleOfficeError(ctx: RouteContext, err: unknown): void {
  if (err instanceof AgentOfficeError) {
    const mapped = mapOfficeError(err);
    ctx.sendError(ctx.res, mapped.status, mapped.code, err.message, ctx.origin);
    return;
  }
  handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
}

function guardOffice(ctx: RouteContext): boolean {
  if (ctx.office === undefined) {
    ctx.sendError(ctx.res, 500, "office_not_configured", "Office is not configured.", ctx.origin);
    return false;
  }
  return true;
}

// Spec: a successful DELETE returns 204 No Content (no body). Mirrors the
// bridge's existing 204 shape (cors.ts preflight): writeHead + end, CORS origin
// echoed when present.
function sendNoContent(ctx: RouteContext): void {
  const headers: Record<string, string> = ctx.origin
    ? { "access-control-allow-origin": ctx.origin, vary: "origin" }
    : {};
  ctx.res.writeHead(204, headers);
  ctx.res.end();
}

// SECURITY: validate the workspace key BEFORE any store/path call so a malformed
// `wk` cannot reach a filesystem path (e.g. the SSE watch dir) or echo back in a
// 500. Returns the branded key on success, or null after sending a 400.
function validateWk(ctx: RouteContext, wk: string): WorkspaceKey | null {
  const parsed = workspaceKeySchema.safeParse(wk);
  if (!parsed.success) {
    ctx.sendError(ctx.res, 400, "validation_failed", "invalid workspace key", ctx.origin);
    return null;
  }
  return parsed.data;
}

// Roles (global — no workspace scope)

export async function handleListRoles(ctx: RouteContext): Promise<void> {
  if (!guardOffice(ctx)) return;
  try {
    const roles = await listRoles({ storeRoot: ctx.storeRoot });
    ctx.sendJson(ctx.res, 200, roles, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleCreateRole(ctx: RouteContext): Promise<void> {
  if (!guardOffice(ctx)) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = roleCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const role = roleSchema.parse({
      id: ctx.newId(),
      name: parsed.data.name,
      kind: parsed.data.kind,
      persona: parsed.data.persona,
      model: parsed.data.model,
      allowedTools: parsed.data.allowedTools,
      skillPacks: parsed.data.skillPacks,
      permissionMode: parsed.data.permissionMode,
      ...(parsed.data.defaultWorkdir !== undefined
        ? { defaultWorkdir: parsed.data.defaultWorkdir }
        : {}),
      createdAt: ctx.now(),
    });
    await saveRole({ storeRoot: ctx.storeRoot, role });
    ctx.sendJson(ctx.res, 201, role, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleDeleteRole(ctx: RouteContext, roleId: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  const idParse = roleIdSchema.safeParse(roleId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Role not found: ${roleId}`, ctx.origin);
    return;
  }
  try {
    await deleteRole({ storeRoot: ctx.storeRoot, roleId: idParse.data });
    sendNoContent(ctx);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// Agents (workspace-scoped)

export async function handleListAgents(ctx: RouteContext, wk: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  try {
    const agents = await listAgents({ storeRoot: ctx.storeRoot, workspaceKey: wk });
    ctx.sendJson(ctx.res, 200, agents, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleCreateAgent(ctx: RouteContext, wk: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = agentCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  // workdir is derived from the workspace (no longer user-chosen); enforce that
  // it is the workspace's project directory before it reaches the launcher cwd.
  // Runs after agentCreateInputSchema (workdir min(1)) so an empty workdir — whose
  // hash is itself a valid key — is already rejected and cannot alias a workspace.
  if (encodeWorkspaceKey(parsed.data.workdir) !== wk) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      "workdir must match the workspace directory.",
      ctx.origin,
    );
    return;
  }
  try {
    // Load role to derive kind
    const role = await loadRole({ storeRoot: ctx.storeRoot, roleId: parsed.data.roleId });
    const agent = officeAgentSchema.parse({
      id: ctx.newId(),
      name: parsed.data.name,
      roleId: parsed.data.roleId,
      kind: role.kind,
      workspaceKey: wk,
      workdir: parsed.data.workdir,
      status: "idle",
      createdAt: ctx.now(),
    });
    await saveAgent({ storeRoot: ctx.storeRoot, agent });
    ctx.sendJson(ctx.res, 201, agent, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleDeleteAgent(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  try {
    await deleteAgent({ storeRoot: ctx.storeRoot, workspaceKey: wk, officeAgentId: idParse.data });
    sendNoContent(ctx);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// Tasks

export async function handleListTasks(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  try {
    const tasks = await listTasks({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
    });
    ctx.sendJson(ctx.res, 200, tasks, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleCreateTask(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const agentIdParse = officeAgentIdSchema.safeParse(agentId);
  if (!agentIdParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = taskCreateInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const now = ctx.now();
    const task = officeTaskSchema.parse({
      id: ctx.newId(),
      agentId: agentIdParse.data,
      workspaceKey: wk,
      instruction: parsed.data.instruction,
      status: "queued",
      queuedAt: now,
    });
    await saveTask({ storeRoot: ctx.storeRoot, task });
    ctx.sendJson(ctx.res, 201, task, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// Control (run / pause / resume / stop)

export async function handleRunAgent(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  try {
    const agent = await loadAgent({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
    });
    // Fast-path: an agent already `working` has an in-flight drain; return its
    // snapshot without scheduling another (the serializer would no-op anyway).
    if (agent.status === "working") {
      ctx.sendJson(ctx.res, 202, agent, ctx.origin);
      return;
    }
    scheduleDrain(ctx, wk, idParse.data);
    ctx.sendJson(ctx.res, 202, agent, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// One drain at a time per agent, in-process. A file-status `working` check is a
// racy concurrency primitive (read-then-act over an await gap): two near-
// simultaneous run/chat requests can both observe a non-working agent and spawn
// two supervisors on the same workdir. Serializing per `(wk, agentId)` here makes
// a second request CHAIN behind the first instead — which also closes the queue
// gap: a task queued during the tail of one drain is picked up by the chained
// drain (each drain re-lists tasks from scratch), so chat follow-ups are never
// stranded.
const agentDrains = new Map<string, Promise<void>>();

function buildAndDrain(ctx: RouteContext, wk: string, officeAgentId: string): Promise<void> {
  // guardOffice (asserted by callers) guarantees ctx.office is defined.
  const office = ctx.office as NonNullable<typeof ctx.office>;
  const supervisor = createSupervisor({
    storeRoot: ctx.storeRoot,
    registry: office.registry,
    coreRegistry: office.coreRegistry,
    projectId: OFFICE_PROJECT_ID,
    now: ctx.now,
    newId: ctx.newId,
    allowFull: office.allowFull,
    onTranscript: ({ workspaceKey, officeAgentId: aid, entry }) => {
      // Persist for the backlog, then push live to any open stream. The persist
      // is fire-and-forget; a rejection MUST be caught or it becomes an
      // unhandledRejection that can crash the bridge. Live push is best-effort.
      void appendTranscript({
        storeRoot: ctx.storeRoot,
        workspaceKey,
        officeAgentId: aid,
        entry,
      }).catch((err) =>
        console.error(`[office] transcript persist failed for ${workspaceKey}/${aid}:`, err),
      );
      publishTranscript(transcriptKey(workspaceKey, aid), entry);
    },
  });
  return supervisor.drainAgent(wk, officeAgentId).then(() => undefined);
}

function scheduleDrain(ctx: RouteContext, wk: string, officeAgentId: string): void {
  const key = transcriptKey(wk, officeAgentId);
  const prev = agentDrains.get(key) ?? Promise.resolve();
  // Chain after any in-flight drain for this agent. The supervisor settles
  // task/agent to terminal states itself; the catch only surfaces unexpected
  // throws so a single failure can't break the chain.
  const next = prev
    .then(() => buildAndDrain(ctx, wk, officeAgentId))
    .catch((drainErr) =>
      console.error(`[office] drainAgent failed for ${wk}/${officeAgentId}:`, drainErr),
    )
    .finally(() => {
      if (agentDrains.get(key) === next) agentDrains.delete(key);
    });
  agentDrains.set(key, next);
}

// Chat: append a `user` turn to the transcript, queue it as a task, and start a
// drain so the agent replies (resuming its session for continuity). The reply
// streams back over the existing transcript SSE.
export async function handleChat(ctx: RouteContext, wk: string, agentId: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = chatInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const agent = await loadAgent({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
    });
    // The supervisor refuses to drain a paused/stopped/error agent, so a message
    // to one would queue + show a user turn but never get a reply. Reject up front
    // (before persisting the turn) so the user gets a clear signal instead of a
    // dead chat. `idle` and `working` are runnable (working → queues behind the
    // in-flight drain).
    if (agent.status === "paused" || agent.status === "stopped" || agent.status === "error") {
      ctx.sendError(
        ctx.res,
        409,
        "validation_failed",
        `Agent is ${agent.status}; resume or run it before chatting.`,
        ctx.origin,
      );
      return;
    }

    const entry = transcriptEntrySchema.parse({
      id: ctx.newId(),
      seq: 0,
      ts: ctx.now(),
      role: "user",
      text: parsed.data.message,
    });
    await appendTranscript({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
      entry,
    });
    publishTranscript(transcriptKey(wk, idParse.data), entry);

    const task = officeTaskSchema.parse({
      id: ctx.newId(),
      agentId: idParse.data,
      workspaceKey: wk,
      instruction: parsed.data.message,
      status: "queued",
      queuedAt: ctx.now(),
    });
    await saveTask({ storeRoot: ctx.storeRoot, task });

    // Always schedule: the per-agent serializer either runs now (idle) or chains
    // behind the in-flight drain (working), so the queued message is never
    // stranded and two concurrent sends can't double-spawn.
    scheduleDrain(ctx, wk, idParse.data);
    ctx.sendJson(ctx.res, 202, task, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

export async function handleControlAgent(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const parsed = controlInputSchema.safeParse(body);
  if (!parsed.success) {
    ctx.sendError(
      ctx.res,
      400,
      "validation_failed",
      zodErrorMessage(parsed.error),
      ctx.origin,
      parsed.error.issues,
    );
    return;
  }
  try {
    const agent = await loadAgent({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
    });
    let nextStatus: OfficeAgent["status"];
    const action = parsed.data.action;
    if (action === "pause") {
      nextStatus = "paused";
    } else if (action === "resume") {
      // resume from paused or error → idle
      nextStatus = "idle";
    } else {
      // stop
      nextStatus = "stopped";
    }
    const updated = officeAgentSchema.parse({ ...agent, status: nextStatus });
    await saveAgent({ storeRoot: ctx.storeRoot, agent: updated });
    ctx.sendJson(ctx.res, 200, updated, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// Observability

export async function handleListAudit(ctx: RouteContext, wk: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  try {
    const events = await listAudit({ storeRoot: ctx.storeRoot, workspaceKey: wk });
    ctx.sendJson(ctx.res, 200, events, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

async function buildStatusPayload(ctx: RouteContext, wk: string): Promise<unknown> {
  const agents = await listAgents({ storeRoot: ctx.storeRoot, workspaceKey: wk });
  const [allTasks, allAudit] = await Promise.all([
    (async () => {
      const result = [];
      for (const a of agents) {
        const tasks = await listTasks({
          storeRoot: ctx.storeRoot,
          workspaceKey: wk,
          officeAgentId: a.id,
        });
        result.push({ agentId: a.id, tasks });
      }
      return result;
    })(),
    listAudit({ storeRoot: ctx.storeRoot, workspaceKey: wk }),
  ]);

  return {
    agents: agents.map((agent) => {
      const entry = allTasks.find((e) => e.agentId === agent.id);
      const tasks = entry ? entry.tasks : [];
      const running = tasks.find((t) => t.status === "running");
      const earliestQueued = tasks
        .filter((t) => t.status === "queued")
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
      const currentTask = running ?? earliestQueued ?? null;
      const agentAudit = allAudit.filter((e) => e.officeAgentId === agent.id);
      const lastEvent = agentAudit.length > 0 ? agentAudit[agentAudit.length - 1] : null;
      return { agent, currentTask, lastEvent };
    }),
  };
}

export async function handleOfficeStatus(ctx: RouteContext, wk: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  try {
    const payload = await buildStatusPayload(ctx, wk);
    ctx.sendJson(ctx.res, 200, payload, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

const HEARTBEAT_MS = 15000;

export async function handleOfficeStream(ctx: RouteContext, wk: string): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;

  // Write SSE headers
  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (ctx.origin) headers["access-control-allow-origin"] = ctx.origin;
  ctx.res.writeHead(200, headers);

  let closed = false;
  const send = (event: string, data: unknown): void => {
    if (closed) return;
    ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // C6: register timer + watcher cleanup and the disconnect listeners BEFORE the
  // first `await`, so a client that disconnects during the initial snapshot
  // build cannot leak the heartbeat timer or the fs watcher.
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(debounceTimer);
    try {
      watcher?.close();
    } catch {
      /* ignore */
    }
    ctx.res.end();
  };

  const heartbeat = setInterval(() => {
    if (!closed) ctx.res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  ctx.req.on("close", cleanup);
  ctx.req.on("aborted", cleanup);

  // Emit initial snapshot (cleanup is already armed for a mid-await disconnect)
  try {
    const snapshot = await buildStatusPayload(ctx, wk);
    send("snapshot", snapshot);
  } catch {
    // If we can't build snapshot, write a comment and keep stream open
    if (!closed) ctx.res.write(": snapshot_error\n\n");
  }
  if (closed) return;

  // Watch the audit dir for changes and re-emit status
  const watchDir = join(ctx.storeRoot, "office", wk, "audit");
  try {
    watcher = watch(watchDir, { persistent: false }, () => {
      if (closed) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (closed) return;
        try {
          const status = await buildStatusPayload(ctx, wk);
          send("status", status);
        } catch {
          // Ignore re-emit errors; next change will retry
        }
      }, 200);
    });
  } catch {
    // Dir may not exist yet (no tasks run) — watcher is simply absent; heartbeat keeps stream alive
  }
}

// Backlog of a single agent's transcript (assistant text, tool calls, results).
export async function handleListTranscript(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }
  try {
    const entries = await listTranscript({
      storeRoot: ctx.storeRoot,
      workspaceKey: wk,
      officeAgentId: idParse.data,
    });
    ctx.sendJson(ctx.res, 200, entries, ctx.origin);
  } catch (err) {
    handleOfficeError(ctx, err);
  }
}

// Live SSE feed of an agent's transcript. The run handler's onTranscript sink
// publishes new entries to the in-process bus; this stream relays them. The GUI
// fetches the backlog via handleListTranscript first, then opens this for new
// entries only.
export async function handleTranscriptStream(
  ctx: RouteContext,
  wk: string,
  agentId: string,
): Promise<void> {
  if (!guardOffice(ctx)) return;
  if (validateWk(ctx, wk) === null) return;
  const idParse = officeAgentIdSchema.safeParse(agentId);
  if (!idParse.success) {
    ctx.sendError(ctx.res, 404, "office_not_found", `Agent not found: ${agentId}`, ctx.origin);
    return;
  }

  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (ctx.origin) headers["access-control-allow-origin"] = ctx.origin;
  ctx.res.writeHead(200, headers);

  let closed = false;
  const send = (event: string, data: unknown): void => {
    if (closed) return;
    ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = subscribeTranscript(transcriptKey(wk, idParse.data), (entry) => {
    send("transcript", entry);
  });

  const heartbeat = setInterval(() => {
    if (!closed) ctx.res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    ctx.res.end();
  };
  ctx.req.on("close", cleanup);
  ctx.req.on("aborted", cleanup);
}
