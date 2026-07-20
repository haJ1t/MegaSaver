import { flockSync } from "fs-ext";
import { Lm2Error } from "./lm2-errors.js";
import { closeAnchoredFile, openAnchoredUpdateFile, verifyAnchoredFile } from "./lm2-secure-fs.js";

const BUSY_CODES = new Set(["EAGAIN", "EWOULDBLOCK"]);

export type WorkspaceFlock = (descriptor: number) => void;

function exclusiveNonBlocking(descriptor: number): void {
  flockSync(descriptor, "exnb");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function lockError(error: unknown): Lm2Error {
  if (error instanceof Lm2Error && error.code === "index_busy") return error;
  if (BUSY_CODES.has(errorCode(error) ?? "")) {
    return new Lm2Error("index_busy", "LM2 workspace index is busy.");
  }
  return new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
}

export async function withWorkspaceIndexLock<T>(
  path: string,
  work: () => Promise<T>,
  flock: WorkspaceFlock = exclusiveNonBlocking,
): Promise<T> {
  let file: ReturnType<typeof openAnchoredUpdateFile> | undefined;
  try {
    file = openAnchoredUpdateFile(path);
    flock(file.descriptor);
    verifyAnchoredFile(file);
  } catch (error) {
    if (file !== undefined) {
      try {
        closeAnchoredFile(file);
      } catch {
        // The acquisition failure remains the declared non-egress outcome.
      }
    }
    throw lockError(error);
  }

  if (file === undefined) {
    throw new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
  }
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await work();
  } catch (error) {
    failure = error;
  }
  try {
    closeAnchoredFile(file);
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
  return result as T;
}
