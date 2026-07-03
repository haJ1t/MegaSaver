import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type TokenSaverMode, tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export type NormalizedSaver = { enabled: boolean; mode: TokenSaverMode };

const exactRecordSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  mode: tokenSaverModeSchema,
  updatedAt: z.string(),
  scope: z.enum(["exact", "global"]),
});
const familyRecordSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  mode: tokenSaverModeSchema,
  updatedAt: z.string(),
  scope: z.literal("repository"),
  identityDigest: z.string().regex(/^[0-9a-f]{64}$/),
  identityPath: z.string(),
});
// The two shipped pre-v1 shapes.
const legacyRecordSchema = z.object({
  enabled: z.boolean(),
  mode: tokenSaverModeSchema,
  updatedAt: z.string().optional(),
});

// Inlined (8 lines) rather than importing content-store to avoid a package edge.
function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new Error(`Unsafe path segment: ${segment}`);
  }
}

function exactPath(storeRoot: string, workspaceKey: string): string {
  assertSafeSegment(workspaceKey);
  return join(storeRoot, "stats", workspaceKey, "workspace-token-saver.json");
}
function familyPath(storeRoot: string, familyKey: string): string {
  assertSafeSegment(familyKey);
  return join(storeRoot, "stats", "saver-families", `${familyKey}.json`);
}
function globalPath(storeRoot: string): string {
  return join(storeRoot, "stats", "workspace-token-saver-default.json");
}

// Read a regular-file leaf, refusing a symlink (returns "symlink" so the caller
// fails closed). Missing file → null.
function readLeaf(path: string): string | null | "symlink" {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return "symlink";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const parentDir = dirname(path);
  mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  chmodSync(parentDir, 0o700);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, JSON.stringify(value), { mode: 0o600 });
    chmodSync(tempPath, 0o600);
    const fd = openSync(tempPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, path);
    if (process.platform !== "win32") {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      /* temp already renamed */
    }
  }
}

export type ExactClassification =
  | { kind: "v1-exact"; enabled: boolean; mode: TokenSaverMode }
  | { kind: "legacy"; enabled: boolean; mode: TokenSaverMode }
  | { kind: "absent" }
  | { kind: "invalid" };

export function readExactRecord(storeRoot: string, workspaceKey: string): ExactClassification {
  const raw = readLeaf(exactPath(storeRoot, workspaceKey));
  if (raw === null) return { kind: "absent" };
  if (raw === "symlink") return { kind: "invalid" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const v1 = exactRecordSchema.safeParse(parsed);
    if (v1.success && v1.data.scope === "exact")
      return { kind: "v1-exact", enabled: v1.data.enabled, mode: v1.data.mode };
    return { kind: "invalid" };
  }
  const legacy = legacyRecordSchema.safeParse(parsed);
  if (legacy.success)
    return { kind: "legacy", enabled: legacy.data.enabled, mode: legacy.data.mode };
  return { kind: "invalid" };
}

export function readFamilyRecord(
  storeRoot: string,
  familyKey: string,
  expectedDigest: string,
): NormalizedSaver | "invalid" | null {
  const raw = readLeaf(familyPath(storeRoot, familyKey));
  if (raw === null) return null;
  if (raw === "symlink") return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  const rec = familyRecordSchema.safeParse(parsed);
  if (!rec.success) return "invalid";
  if (rec.data.identityDigest !== expectedDigest) return "invalid"; // fail closed
  return { enabled: rec.data.enabled, mode: rec.data.mode };
}

export function readGlobalDefault(storeRoot: string): NormalizedSaver | "invalid" | null {
  const raw = readLeaf(globalPath(storeRoot));
  if (raw === null) return null;
  if (raw === "symlink") return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  const rec = exactRecordSchema.safeParse(parsed);
  if (!rec.success || rec.data.scope !== "global") return "invalid";
  return { enabled: rec.data.enabled, mode: rec.data.mode };
}

export function writeExactRecord(
  storeRoot: string,
  workspaceKey: string,
  input: { enabled: boolean; mode: TokenSaverMode; scope: "exact" },
): void {
  atomicWriteJson(exactPath(storeRoot, workspaceKey), {
    version: 1,
    enabled: input.enabled,
    mode: input.mode,
    updatedAt: new Date().toISOString(),
    scope: input.scope,
  });
}

export function writeFamilyRecord(
  storeRoot: string,
  familyKey: string,
  input: { enabled: boolean; mode: TokenSaverMode; identityDigest: string; identityPath: string },
): void {
  atomicWriteJson(familyPath(storeRoot, familyKey), {
    version: 1,
    enabled: input.enabled,
    mode: input.mode,
    updatedAt: new Date().toISOString(),
    scope: "repository",
    identityDigest: input.identityDigest,
    identityPath: input.identityPath,
  });
}

export function writeGlobalDefault(
  storeRoot: string,
  input: { enabled: boolean; mode: TokenSaverMode },
): void {
  atomicWriteJson(globalPath(storeRoot), {
    version: 1,
    enabled: input.enabled,
    mode: input.mode,
    updatedAt: new Date().toISOString(),
    scope: "global",
  });
}

// Owner-only activation lock. Activation writes are user-initiated, infrequent,
// and single-record, so a lightweight wx-create + stale-by-age lock is
// sufficient — the proxy-grade fenced/boot-id identity is deliberately not used
// here (it guards a reboot-persistent daemon, a different problem).
const LOCK_TTL_MS = 30_000;

export function withActivationLock<T>(storeRoot: string, fn: () => T): T {
  const dir = join(storeRoot, "stats");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, ".saver-activation.lock");
  acquire(lock);
  try {
    return fn();
  } finally {
    try {
      rmSync(lock, { force: true });
    } catch {
      /* best-effort release */
    }
  }
}

function acquire(lock: string): void {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return;
    } catch {
      // Held: reclaim if stale (dead writer), else brief spin.
      try {
        const st = lstatSync(lock);
        if (Date.now() - st.mtimeMs > LOCK_TTL_MS) {
          rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // vanished between open and stat — retry
      }
      sleep(10);
    }
  }
  throw new Error("saver activation lock is held");
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* short spin; activation writes are rare */
  }
}
