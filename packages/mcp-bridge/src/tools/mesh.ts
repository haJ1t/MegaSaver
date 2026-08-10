import { z } from "zod";

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
