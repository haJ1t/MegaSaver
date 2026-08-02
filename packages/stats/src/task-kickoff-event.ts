import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { appendPrivateLine } from "./append-line.js";
import { StatsError } from "./errors.js";

export const taskKickoffEventSchema = z
  .object({
    id: z.string().uuid(),
    workspaceKey: workspaceKeySchema,
    sessionId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    tokenCount: z.number().int().nonnegative(),
  })
  .strict();

export type TaskKickoffEvent = z.infer<typeof taskKickoffEventSchema>;

type StoreRoot = { root: string; deadlineAtMs?: number };

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isNativeAppendUnavailable(error: unknown): boolean {
  return hasErrorCode(error, "MODULE_NOT_FOUND") || hasErrorCode(error, "ERR_MODULE_NOT_FOUND");
}

function taskKickoffPartsPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKeySchema.parse(workspaceKey), "task-kickoff-parts");
}

function assertBeforeDeadline(deadlineAtMs: number | undefined): void {
  if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
    throw new Error("task kickoff event deadline expired");
  }
}

function assertPrivateDirectory(path: string): void {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("task kickoff event part target is not a private directory");
  }
}

function appendTaskKickoffPart(
  storeRoot: string,
  event: TaskKickoffEvent,
  deadlineAtMs: number | undefined,
): void {
  assertBeforeDeadline(deadlineAtMs);
  const partsPath = taskKickoffPartsPath(storeRoot, event.workspaceKey);
  mkdirSync(partsPath, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(partsPath);
  chmodSync(partsPath, 0o700);
  const eventPath = join(partsPath, event.id);
  try {
    mkdirSync(eventPath, { mode: 0o700 });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) assertPrivateDirectory(eventPath);
    throw error;
  }
  assertPrivateDirectory(eventPath);
  chmodSync(eventPath, 0o700);
  const temporaryPath = join(eventPath, ".event.json.tmp");
  const publishedPath = join(eventPath, "event.json");
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(event)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, publishedPath);
    const published = lstatSync(publishedPath);
    if (!published.isFile() || published.isSymbolicLink()) {
      throw new Error("task kickoff event part is not a regular file");
    }
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readTaskKickoffParts(storeRoot: string, workspaceKey: string): TaskKickoffEvent[] {
  const partsPath = taskKickoffPartsPath(storeRoot, workspaceKey);
  if (!existsSync(partsPath)) return [];
  try {
    if (!lstatSync(partsPath).isDirectory() || lstatSync(partsPath).isSymbolicLink()) return [];
  } catch {
    return [];
  }
  const events: TaskKickoffEvent[] = [];
  for (const part of readdirSync(partsPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!part.isDirectory()) continue;
    const partPath = join(partsPath, part.name);
    const eventPath = join(partPath, "event.json");
    let raw: unknown;
    try {
      const partStats = lstatSync(partPath);
      if (!partStats.isDirectory() || partStats.isSymbolicLink()) continue;
      if (!lstatSync(eventPath).isFile()) continue;
      raw = JSON.parse(readFileSync(eventPath, "utf8"));
    } catch {
      continue;
    }
    const parsed = taskKickoffEventSchema.safeParse(raw);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

export function taskKickoffEventPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKeySchema.parse(workspaceKey), "task-kickoff.jsonl");
}

export function appendTaskKickoffEventFallback(store: StoreRoot, event: TaskKickoffEvent): void {
  const parsed = taskKickoffEventSchema.safeParse(event);
  if (!parsed.success) throw new StatsError("schema_invalid");
  appendTaskKickoffPart(store.root, parsed.data, store.deadlineAtMs);
}

export function appendTaskKickoffEvent(store: StoreRoot, event: TaskKickoffEvent): void {
  const parsed = taskKickoffEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  try {
    appendPrivateLine(
      taskKickoffEventPath(store.root, parsed.data.workspaceKey),
      `${JSON.stringify(parsed.data)}\n`,
      store.deadlineAtMs,
    );
  } catch (error) {
    if (!isNativeAppendUnavailable(error)) throw error;
    appendTaskKickoffEventFallback(store, parsed.data);
  }
}

export function readTaskKickoffEvents(store: StoreRoot, workspaceKey: string): TaskKickoffEvent[] {
  const parsedWorkspaceKey = workspaceKeySchema.safeParse(workspaceKey);
  if (!parsedWorkspaceKey.success) return [];
  const path = taskKickoffEventPath(store.root, parsedWorkspaceKey.data);
  const events: TaskKickoffEvent[] = [];
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = taskKickoffEventSchema.safeParse(raw);
      if (parsed.success) events.push(parsed.data);
    }
  }
  const eventIds = new Set(events.map((event) => event.id));
  for (const event of readTaskKickoffParts(store.root, parsedWorkspaceKey.data)) {
    if (eventIds.has(event.id)) continue;
    eventIds.add(event.id);
    events.push(event);
  }
  return events;
}
