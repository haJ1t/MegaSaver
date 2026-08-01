import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { appendPrivateLine } from "./append-line.js";
import { StatsError } from "./errors.js";

export const taskKickoffEventSchema = z
  .object({
    id: z.string().uuid(),
    workspaceKey: z.string().min(1),
    sessionId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    tokenCount: z.number().int().nonnegative(),
  })
  .strict();

export type TaskKickoffEvent = z.infer<typeof taskKickoffEventSchema>;

const taskKickoffRetractionSchema = z
  .object({
    kind: z.literal("retract"),
    id: z.string().uuid(),
    workspaceKey: z.string().min(1),
  })
  .strict();

type StoreRoot = { root: string };

export function taskKickoffEventPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "task-kickoff.jsonl");
}

export function appendTaskKickoffEvent(store: StoreRoot, event: TaskKickoffEvent): void {
  const parsed = taskKickoffEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  appendPrivateLine(
    taskKickoffEventPath(store.root, parsed.data.workspaceKey),
    `${JSON.stringify(parsed.data)}\n`,
  );
}

export function retractTaskKickoffEvent(store: StoreRoot, event: TaskKickoffEvent): void {
  const parsed = taskKickoffEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const retraction = taskKickoffRetractionSchema.parse({
    kind: "retract",
    id: parsed.data.id,
    workspaceKey: parsed.data.workspaceKey,
  });
  appendPrivateLine(
    taskKickoffEventPath(store.root, retraction.workspaceKey),
    `${JSON.stringify(retraction)}\n`,
  );
}

export function readTaskKickoffEvents(store: StoreRoot, workspaceKey: string): TaskKickoffEvent[] {
  const path = taskKickoffEventPath(store.root, workspaceKey);
  if (!existsSync(path)) return [];
  const events: TaskKickoffEvent[] = [];
  const retractedIds = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const retraction = taskKickoffRetractionSchema.safeParse(raw);
    if (retraction.success) {
      retractedIds.add(retraction.data.id);
      continue;
    }
    const parsed = taskKickoffEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events.filter((event) => !retractedIds.has(event.id));
}
