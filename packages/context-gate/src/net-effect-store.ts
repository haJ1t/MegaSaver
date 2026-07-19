import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// P0 verdict persistence. Doctor computes and WRITES; the PostToolUse hook only
// READS (one small JSON per invocation — same cost class as settings reads).
// Fail-open everywhere: a missing or corrupt record never pauses the saver.

const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const netEffectRecordSchema = z.object({
  version: z.literal(1),
  savedTokens: z.number().int().nonnegative(),
  churnTokens: z.number().int().nonnegative(),
  verdict: z.enum(["ok", "negative", "unknown"]),
  updatedAt: z.string(),
  resumeOverrideAt: z.string().optional(),
});

export type NetEffectRecord = Omit<z.infer<typeof netEffectRecordSchema>, "version">;

function recordPath(storeRoot: string, workspaceKey: string): string {
  return join(storeRoot, "stats", workspaceKey, "net-effect.json");
}

function writeAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function writeNetEffectRecord(
  storeRoot: string,
  workspaceKey: string,
  record: Omit<NetEffectRecord, "resumeOverrideAt">,
): void {
  // Preserve an existing resume override across verdict refreshes.
  const prev = readNetEffectRecord(storeRoot, workspaceKey);
  writeAtomic(recordPath(storeRoot, workspaceKey), {
    version: 1,
    ...record,
    ...(prev?.resumeOverrideAt !== undefined ? { resumeOverrideAt: prev.resumeOverrideAt } : {}),
  });
}

export function writeResumeOverride(storeRoot: string, workspaceKey: string, atIso: string): void {
  const prev = readNetEffectRecord(storeRoot, workspaceKey);
  if (prev === null) return; // nothing to override
  writeAtomic(recordPath(storeRoot, workspaceKey), {
    version: 1,
    ...prev,
    resumeOverrideAt: atIso,
  });
}

export function readNetEffectRecord(
  storeRoot: string,
  workspaceKey: string,
): NetEffectRecord | null {
  const path = recordPath(storeRoot, workspaceKey);
  if (!existsSync(path)) return null;
  try {
    const parsed = netEffectRecordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return null;
    const { version: _v, ...rest } = parsed.data;
    return rest;
  } catch {
    return null;
  }
}

export function saverPausedByNetEffect(
  storeRoot: string,
  workspaceKey: string,
  nowIso: string,
): boolean {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return false;
  const record = readNetEffectRecord(storeRoot, workspaceKey);
  if (record === null || record.verdict !== "negative") return false;
  if (record.resumeOverrideAt !== undefined) {
    const at = Date.parse(record.resumeOverrideAt);
    if (Number.isFinite(at) && now - at < RESUME_WINDOW_MS) return false;
  }
  return true;
}
