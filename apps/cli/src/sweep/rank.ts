export const RESIDUE_BUCKETS = ["tmp", "cache", "build-output", "agent-draft", "other"] as const;
export type ResidueBucket = (typeof RESIDUE_BUCKETS)[number];

export type RankedEntry = {
  relPath: string;
  bucket: ResidueBucket;
  size: number;
  mtimeMs: number;
};

export const SAFE_REL_PATH = /^[A-Za-z0-9._\-][A-Za-z0-9._\-\/]{0,511}$/;

export function isQuarantineRelPath(relPath: string): boolean {
  return (
    relPath.startsWith(".megasaver/quarantine") || relPath.startsWith(".megasaver\\quarantine")
  );
}

export function isFencedRelPath(relPath: string): boolean {
  // Minimal fence: generated files per generated-file-fence spec, plus .megasaver itself
  if (relPath.startsWith(".megasaver/")) return true;
  if (relPath.match(/^generated\//)) return true;
  if (relPath.includes("/generated/")) return true;
  return false;
}

function bucketFor(relPath: string): ResidueBucket {
  const lower = relPath.toLowerCase();
  if (
    lower.endsWith(".tmp") ||
    lower.endsWith(".log") ||
    lower.endsWith(".bak") ||
    lower.endsWith(".ds_store") ||
    lower.endsWith("thumbs.db") ||
    lower.endsWith(".swp")
  )
    return "tmp";
  if (
    lower.includes("node_modules/.cache") ||
    lower.includes(".turbo") ||
    lower.includes(".next/cache")
  )
    return "cache";
  if (
    (lower.startsWith("dist/") || lower.startsWith("build/") || lower.startsWith("coverage/")) &&
    !lower.endsWith(".json")
  )
    return "build-output";
  // agent-draft: will be determined by mtime window in rankResidue, but fallback to other
  return "other";
}

export function rankResidue(
  entries: { relPath: string; size: number; mtimeMs: number }[],
  ctx: { sessionWindowMs?: number; nowMs?: number } = {},
): RankedEntry[] {
  const now = ctx.nowMs ?? Date.now();
  const window = ctx.sessionWindowMs ?? 60 * 60 * 1000;
  const out: RankedEntry[] = [];
  for (const e of entries) {
    if (isQuarantineRelPath(e.relPath)) continue;
    if (isFencedRelPath(e.relPath)) continue;
    if (!SAFE_REL_PATH.test(e.relPath)) continue;
    if (e.relPath.includes("..")) continue;
    let bucket = bucketFor(e.relPath);
    if (bucket === "other" && now - e.mtimeMs < window) {
      // heuristic: recent file not in other buckets -> agent-draft
      bucket = "agent-draft";
    }
    out.push({ relPath: e.relPath, bucket, size: e.size, mtimeMs: e.mtimeMs });
  }
  const order = new Map<ResidueBucket, number>([
    ["tmp", 0],
    ["cache", 1],
    ["build-output", 2],
    ["agent-draft", 3],
    ["other", 4],
  ]);
  out.sort((a, b) => {
    const oa = order.get(a.bucket) ?? 99;
    const ob = order.get(b.bucket) ?? 99;
    if (oa !== ob) return oa - ob;
    return a.relPath.localeCompare(b.relPath);
  });
  return out;
}
