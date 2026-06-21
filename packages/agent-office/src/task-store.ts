import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { taskPath, tasksDir } from "./paths.js";
import { type OfficeTask, officeTaskSchema } from "./task.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseTaskFile(path: string, raw: string): OfficeTask {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt task file: ${path}`, { cause: error });
  }
  try {
    return officeTaskSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt task file: ${path}`, { cause: error });
  }
}

export async function saveTask(input: { storeRoot: string; task: OfficeTask }): Promise<void> {
  let task: OfficeTask;
  try {
    task = officeTaskSchema.parse(input.task);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Task is invalid.", { cause: error });
  }
  const path = taskPath({
    storeRoot: input.storeRoot,
    workspaceKey: task.workspaceKey,
    officeAgentId: task.agentId,
    officeTaskId: task.id,
  });
  atomicWriteFile(path, `${JSON.stringify(task, null, 2)}\n`);
}

export async function loadTask(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): Promise<OfficeTask> {
  const path = taskPath(input);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Task not found: ${input.officeTaskId}`);
    }
    throw error;
  }
  return parseTaskFile(path, raw);
}

export async function listTasks(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<readonly OfficeTask[]> {
  const dir = tasksDir(input.storeRoot, input.workspaceKey, input.officeAgentId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const tasks: OfficeTask[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    tasks.push(parseTaskFile(path, readFileSync(path, "utf8")));
  }
  return tasks;
}

export async function deleteTask(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): Promise<void> {
  const path = taskPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.officeTaskId}`, {
      cause: error,
    });
  }
}
