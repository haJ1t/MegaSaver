import {
  claimPaths,
  drainInbox,
  heartbeat,
  listPeers,
  readEvents,
  releaseClaim,
  sendMessage,
} from "@megasaver/mesh";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";

export const meshBroadcastInputSchema = z
  .object({
    kind: z.enum(["memory_added", "task_step_completed", "gotcha_discovered", "handoff_ready"]),
    payload: z.record(z.unknown()),
    senderAgentId: z.string().min(1).optional(),
  })
  .strict();

export const meshQueryInputSchema = z
  .object({ agentId: z.string().optional(), limit: z.number().int().positive().optional() })
  .strict();

export async function handleMeshBroadcast(
  env: { hub: { broadcast: (e: unknown) => Promise<void> } },
  rawArgs: unknown,
): Promise<{ eventId: string }> {
  const parsed = meshBroadcastInputSchema.parse(rawArgs);
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await env.hub.broadcast({
    eventId,
    senderAgentId: parsed.senderAgentId ?? "mcp",
    kind: parsed.kind,
    payload: parsed.payload,
    timestamp: new Date().toISOString(),
  });
  return { eventId };
}

export async function handleMeshQuery(
  env: { hub: { listSessions: () => unknown[]; log: () => unknown[] } },
  rawArgs: unknown,
): Promise<{ sessions: unknown[]; events: unknown[] }> {
  const parsed = meshQueryInputSchema.parse(rawArgs);
  const sessions = env.hub.listSessions();
  const events = env.hub.log().slice(-(parsed.limit ?? 20));
  const filtered = parsed.agentId
    ? sessions.filter((s: unknown) => (s as { agentId: string }).agentId === parsed.agentId)
    : sessions;
  return { sessions: filtered, events };
}

// ── New 7 mesh tools (Task 5) ───────────────────────────────────────────────

const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const workspaceKeyRegex = /^[0-9a-f]{16}$/;
const familyKeyRegex = /^gf1_[A-Za-z0-9_-]{43}$/;

export const meshClaimInputSchema = z
  .object({
    liveSessionId: z.string().regex(safeSegment, "unsafe liveSessionId"),
    paths: z.array(z.string().min(1).max(1024)).min(1).max(64),
    intent: z.string().max(10_000).optional(),
  })
  .strict();

export const meshEventsInputSchema = z
  .object({
    since: z.string().datetime({ offset: true }).optional(),
    repo: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const meshPeersInputSchema = z
  .object({
    workspaceKey: z.string().regex(workspaceKeyRegex).optional(),
    repositoryFamilyKey: z.string().regex(familyKeyRegex).optional(),
    all: z.boolean().optional(),
  })
  .strict();

export const meshPollInputSchema = z
  .object({ liveSessionId: z.string().regex(safeSegment, "unsafe liveSessionId") })
  .strict();

export const meshReleaseInputSchema = z
  .object({ claimId: z.string().regex(safeSegment, "unsafe claimId") })
  .strict();

export const meshSendInputSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1).optional(),
    kind: z.enum(["message", "ask", "answer"]).optional(),
    text: z.string().min(1).max(4000),
  })
  .strict();

export const meshStatusSetInputSchema = z
  .object({
    liveSessionId: z.string().regex(safeSegment, "unsafe liveSessionId"),
    status: z.enum(["working", "blocked", "idle", "done"]),
    task: z.string().max(256).optional(),
  })
  .strict();

export type MeshStoreEnv = { storeRoot: string };

export async function handleMeshClaim(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ claimId: string; record: unknown }> {
  const parsed = meshClaimInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const rec = claimPaths(env.storeRoot, {
      liveSessionId: parsed.data.liveSessionId,
      paths: parsed.data.paths,
      ...(parsed.data.intent !== undefined ? { intent: parsed.data.intent } : {}),
    });
    return { claimId: rec.claimId, record: rec };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_claim failed",
    );
  }
}

export async function handleMeshEvents(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ events: unknown[] }> {
  const parsed = meshEventsInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const events = readEvents(env.storeRoot, {
      ...(parsed.data.since !== undefined ? { since: parsed.data.since } : {}),
      ...(parsed.data.repo !== undefined ? { repo: parsed.data.repo } : {}),
    });
    const limit = parsed.data.limit ?? 500;
    const sliced = events.length > limit ? events.slice(-limit) : events;
    return { events: sliced };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_events failed",
    );
  }
}

export async function handleMeshPeers(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ peers: unknown[] }> {
  const parsed = meshPeersInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const peers = listPeers(env.storeRoot, {
      ...(parsed.data.workspaceKey !== undefined ? { workspaceKey: parsed.data.workspaceKey } : {}),
      ...(parsed.data.repositoryFamilyKey !== undefined
        ? { repositoryFamilyKey: parsed.data.repositoryFamilyKey }
        : {}),
      ...(parsed.data.all !== undefined ? { all: parsed.data.all } : {}),
    });
    return { peers };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_peers failed",
    );
  }
}

export async function handleMeshPoll(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ events: unknown[] }> {
  const parsed = meshPollInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const events = drainInbox(env.storeRoot, parsed.data.liveSessionId);
    return { events };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_poll failed",
    );
  }
}

export async function handleMeshRelease(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ released: boolean }> {
  const parsed = meshReleaseInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const released = releaseClaim(env.storeRoot, parsed.data.claimId);
    return { released };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_release failed",
    );
  }
}

export async function handleMeshSend(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ id: string; event: unknown }> {
  const parsed = meshSendInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    const evt = sendMessage(env.storeRoot, {
      from: parsed.data.from,
      to: parsed.data.to,
      kind: parsed.data.kind ?? "message",
      text: parsed.data.text,
    });
    return { id: evt.id, event: evt };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_send failed",
    );
  }
}

export async function handleMeshStatusSet(
  env: MeshStoreEnv,
  rawArgs: unknown,
): Promise<{ ok: boolean }> {
  const parsed = meshStatusSetInputSchema.safeParse(rawArgs);
  if (!parsed.success) throw new McpBridgeError("validation_failed", parsed.error.message);
  try {
    heartbeat(env.storeRoot, parsed.data.liveSessionId, {
      status: parsed.data.status,
      ...(parsed.data.task !== undefined ? { task: parsed.data.task } : {}),
    });
    return { ok: true };
  } catch (err) {
    throw new McpBridgeError(
      "validation_failed",
      err instanceof Error ? err.message : "mesh_status_set failed",
    );
  }
}
