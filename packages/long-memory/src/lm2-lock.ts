import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  readSync,
  writeSync,
} from "node:fs";
import { flockSync } from "fs-ext";
import { Lm2Error } from "./lm2-errors.js";
import { type LosslessFileIdentity, losslessFileIdentity } from "./lm2-fs-platform.js";
import type { EmbeddingPort, Lm2Candidate, ModelDescriptor } from "./lm2-model.js";
import { closeAnchoredFile, openAnchoredUpdateFile, verifyAnchoredFile } from "./lm2-secure-fs.js";

const BUSY_CODES = new Set(["EAGAIN", "EWOULDBLOCK"]);
const TOKEN_BYTES = 65;

export type WorkspaceFlock = (descriptor: number) => void;

export type WorkspaceIndexLockGuard = {
  readonly identity: LosslessFileIdentity;
  readonly token: string;
  assertIntact(): void;
  release(): void;
};

export type WorkspaceIndexLockResult =
  | { status: "acquired"; guard: WorkspaceIndexLockGuard }
  | { status: "busy" }
  | { status: "unavailable" };

export type Lm2IndexDeadline = {
  signal: AbortSignal;
  deadlineAtMs: number;
  now(): number;
};

export class Lm2ApprovalTimeoutError extends Error {
  constructor() {
    super("LM2 remote approval wait expired.");
    this.name = "Lm2ApprovalTimeoutError";
  }
}

export type Lm2PublishBatchResult = {
  published: readonly string[];
  existing: readonly string[];
  reason:
    | null
    | "storage_limit"
    | "invalid_vectors"
    | "port_failure"
    | "remote_approval_denied"
    | "write_failed"
    | "evidence_changed"
    | "timeout"
    | "lock_integrity_lost"
    | "quota_state_invalid";
  quotaRecovery?: "blocked_pending";
};

export type Lm2ReadyIndexOperation = {
  status: "ready";
  quotaRecovery: "not_needed" | "recovered_pending";
  publishBatch(input: {
    records: readonly Lm2Candidate[];
    embed: EmbeddingPort["embed"];
    assertEgressAllowed(): Promise<boolean>;
    recheckEvidence(record: Lm2Candidate): Promise<boolean>;
  }): Promise<Lm2PublishBatchResult>;
  finalize(): Promise<void>;
};

export type Lm2IndexOperationResult =
  | Lm2ReadyIndexOperation
  | { status: "busy" }
  | { status: "unavailable" }
  | { status: "invalid"; quotaRecovery: "not_needed" | "blocked_pending" };

export type BeginLm2IndexOperationInput = {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  deadline: Lm2IndexDeadline;
};

function exclusiveNonBlocking(descriptor: number): void {
  flockSync(descriptor, "exnb");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function readToken(descriptor: number): string | null {
  const bytes = Buffer.alloc(TOKEN_BYTES + 1);
  const count = readSync(descriptor, bytes, 0, bytes.length, 0);
  if (count === 0) return null;
  const value = bytes.subarray(0, count).toString("utf8");
  return count === TOKEN_BYTES && /^[0-9a-f]{64}\n$/.test(value) ? value.slice(0, -1) : "";
}

function initializeToken(descriptor: number): string {
  const token = randomBytes(32).toString("hex");
  const bytes = Buffer.from(`${token}\n`, "utf8");
  ftruncateSync(descriptor, 0);
  let written = 0;
  while (written < bytes.length) {
    written += writeSync(descriptor, bytes, written, bytes.length - written, written);
  }
  fsyncSync(descriptor);
  return token;
}

function lockedFileIdentity(file: ReturnType<typeof openAnchoredUpdateFile>): LosslessFileIdentity {
  const descriptor = fstatSync(file.descriptor, { bigint: true });
  const path = lstatSync(file.path, { bigint: true });
  if (
    !descriptor.isFile() ||
    !path.isFile() ||
    descriptor.dev !== path.dev ||
    descriptor.ino !== path.ino
  ) {
    throw new Lm2Error("index_lock_unavailable", "LM2 fixed lock identity changed.");
  }
  return losslessFileIdentity(descriptor);
}

export function acquireWorkspaceIndexLock(
  path: string,
  flock: WorkspaceFlock = exclusiveNonBlocking,
): WorkspaceIndexLockResult {
  let file: ReturnType<typeof openAnchoredUpdateFile> | undefined;
  try {
    file = openAnchoredUpdateFile(path);
    flock(file.descriptor);
    verifyAnchoredFile(file);
    const existingToken = readToken(file.descriptor);
    const token = existingToken === null ? initializeToken(file.descriptor) : existingToken;
    if (token.length !== 64) throw new Error("invalid fixed lock token");
    verifyAnchoredFile(file);
    const identity = lockedFileIdentity(file);
    let released = false;
    const lockedFile = file;
    return {
      status: "acquired",
      guard: {
        identity,
        token,
        assertIntact() {
          if (released) throw new Lm2Error("index_lock_unavailable", "LM2 lock was released.");
          verifyAnchoredFile(lockedFile);
          const currentIdentity = lockedFileIdentity(lockedFile);
          if (
            currentIdentity.device !== identity.device ||
            currentIdentity.inode !== identity.inode
          ) {
            throw new Lm2Error("index_lock_unavailable", "LM2 fixed lock identity changed.");
          }
          if (readToken(lockedFile.descriptor) !== token) {
            throw new Lm2Error("index_lock_unavailable", "LM2 fixed lock token changed.");
          }
        },
        release() {
          if (released) return;
          released = true;
          closeAnchoredFile(lockedFile);
        },
      },
    };
  } catch (error) {
    if (file !== undefined) {
      try {
        closeAnchoredFile(file);
      } catch {
        // Acquisition outcome is already fail-closed.
      }
    }
    return BUSY_CODES.has(errorCode(error) ?? "") ? { status: "busy" } : { status: "unavailable" };
  }
}

export async function withWorkspaceIndexLock<T>(
  path: string,
  work: (guard: WorkspaceIndexLockGuard) => Promise<T>,
  flock: WorkspaceFlock = exclusiveNonBlocking,
): Promise<T> {
  const acquired = acquireWorkspaceIndexLock(path, flock);
  if (acquired.status === "busy") throw new Lm2Error("index_busy", "LM2 workspace index is busy.");
  if (acquired.status === "unavailable") {
    throw new Lm2Error("index_lock_unavailable", "LM2 workspace index lock is unavailable.");
  }
  try {
    return await work(acquired.guard);
  } finally {
    acquired.guard.release();
  }
}
