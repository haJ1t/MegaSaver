import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

// P0 verdict persistence. Doctor computes and WRITES; `mega session saver
// resolve` READS it to show the last advisory. Nothing acts on it — the verdict
// is an unattributed dispersion advisory, never a gate (see @megasaver/stats
// net-effect.ts). Fail-open: a missing or corrupt record is simply absent.

const netEffectRecordSchema = z.object({
  version: z.literal(1),
  savedTokens: z.number().int().nonnegative(),
  excessTokens: z.number().int().nonnegative(),
  verdict: z.enum(["ok", "negative", "unknown"]),
  updatedAt: z.string(),
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
  record: NetEffectRecord,
): void {
  writeAtomic(recordPath(storeRoot, workspaceKey), { version: 1, ...record });
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
