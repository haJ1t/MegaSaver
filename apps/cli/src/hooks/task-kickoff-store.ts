import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type FileHandle, chmod, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export type StoredTaskKickoffPack = {
  taskHash: string;
  text: string;
  tokenCount: number;
  createdAt: number;
};

export type TaskKickoffSessionClaim = {
  workspaceKey: string;
  eventId: string;
  createdAt: string;
};

const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const storedTaskKickoffPackSchema = z
  .object({
    taskHash: z.string().regex(/^[a-f0-9]{64}$/),
    text: z.string().min(1),
    tokenCount: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const taskKickoffSessionClaimSchema = z
  .object({
    workspaceKey: z.string().min(1),
    eventId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export function isSafeHookSessionId(value: string): boolean {
  return safeSessionId.test(value);
}

export function taskKickoffPackPath(root: string, workspace: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", workspace, "task-pack", `${session}.json`);
}

export function taskKickoffSessionClaimPath(root: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", "task-kickoff-sessions", `${session}.json`);
}

export function hasTaskKickoffSessionClaim(storeRoot: string, sessionId: string): boolean {
  if (!isSafeHookSessionId(sessionId)) return false;
  return existsSync(taskKickoffSessionClaimPath(storeRoot, sessionId));
}

export async function createTaskKickoffSessionClaim(
  storeRoot: string,
  sessionId: string,
  claim: TaskKickoffSessionClaim,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const parsed = taskKickoffSessionClaimSchema.parse(claim);
  const path = taskKickoffSessionClaimPath(storeRoot, sessionId);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if (signal.aborted) return false;

  let handle: FileHandle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }

  try {
    if (signal.aborted) return false;
    await handle.writeFile(`${JSON.stringify(parsed)}\n`);
    await handle.sync();
    if (signal.aborted) return false;
    return true;
  } finally {
    await handle.close();
  }
}

export function readTaskKickoffPack(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
): StoredTaskKickoffPack | undefined {
  if (!isSafeHookSessionId(sessionId)) return undefined;
  try {
    const path = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
    const parsed = storedTaskKickoffPackSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function writeTaskKickoffPack(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  pack: StoredTaskKickoffPack,
): void {
  const validated = storedTaskKickoffPackSchema.parse(pack);
  const path = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the failure that caused this write to fail.
    }
    throw error;
  }
}
