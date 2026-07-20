import { closeSync, openSync } from "node:fs";
import { flockSync } from "fs-ext";
import { Lm2Error } from "./lm2-errors.js";

const BUSY_CODES = new Set(["EAGAIN", "EWOULDBLOCK"]);

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export async function withWorkspaceIndexLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  let descriptor: number;
  try {
    descriptor = openSync(path, "a+", 0o600);
  } catch {
    throw new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
  }

  let result: T | undefined;
  let failure: unknown;
  try {
    try {
      flockSync(descriptor, "exnb");
    } catch (error) {
      if (BUSY_CODES.has(errorCode(error) ?? "")) {
        throw new Lm2Error("index_busy", "LM2 workspace index is busy.");
      }
      throw new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
    }
    result = await work();
  } catch (error) {
    failure = error;
  }
  try {
    closeSync(descriptor);
  } catch {
    failure ??= new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
  }
  if (failure !== undefined) throw failure;
  return result as T;
}
