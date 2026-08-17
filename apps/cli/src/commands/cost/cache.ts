import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SavingsReceipt } from "@megasaver/core";
import { z } from "zod";
import { listSavingsEventFiles } from "./collect.js";

const fingerprintEntrySchema = z.object({
  path: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
});

const cacheFileSchema = z.object({
  version: z.literal(1),
  fingerprint: z.array(fingerprintEntrySchema),
  savings: z.array(
    z.object({
      createdAt: z.string(),
      project: z.string().optional(),
      session: z.string().optional(),
      deltaTokens: z.number().int().optional(),
    }),
  ),
});

export type CostCacheFingerprint = z.infer<typeof fingerprintEntrySchema>[];

export function costCachePath(storeRoot: string): string {
  return join(storeRoot, "cost-ledger", "cache.json");
}

// Fingerprint = every session .events.jsonl the savings walk would read,
// sorted, with size + mtimeMs. Added/removed/changed files all change it, so
// the cache can never serve stale receipts. `path` is a portable cache KEY
// (forward slashes on purpose), never used to open a file.
export function savingsFingerprint(storeRoot: string): CostCacheFingerprint {
  const entries: CostCacheFingerprint = [];
  for (const { dir, file } of listSavingsEventFiles(storeRoot)) {
    try {
      const s = statSync(join(storeRoot, "stats", dir, file));
      entries.push({ path: `${dir}/${file}`, size: s.size, mtimeMs: s.mtimeMs });
    } catch {
      // Raced deletion: absence changes the fingerprint by omission.
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export function readCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
): SavingsReceipt[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(costCachePath(storeRoot), "utf8"));
  } catch {
    return undefined;
  }
  const cache = cacheFileSchema.safeParse(parsed);
  if (!cache.success) return undefined;
  if (JSON.stringify(cache.data.fingerprint) !== JSON.stringify(fingerprint)) {
    return undefined;
  }
  return cache.data.savings;
}

// Best-effort, atomic (tmp + rename). Any failure — including a Windows EPERM
// rename over an open handle (seen-ledger lesson) — leaves no cache; the next
// run silently recomputes.
export function writeCostCache(
  storeRoot: string,
  fingerprint: CostCacheFingerprint,
  savings: readonly SavingsReceipt[],
): void {
  const path = costCachePath(storeRoot);
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(join(storeRoot, "cost-ledger"), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, JSON.stringify({ version: 1, fingerprint, savings }), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}
