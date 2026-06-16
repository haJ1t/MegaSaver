// Read-boundary upgrade: rows written before the lifecycle fields existed get
// neutral defaults so existing on-disk evidence keeps loading. Mirrors the
// `backfillMemoryEntry` pattern in @megasaver/core.
export function backfillEvidenceRecord(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  const rec = raw as Record<string, unknown>;
  if ("status" in rec && "transitions" in rec && "pinnedByMemoryIds" in rec) {
    return rec;
  }
  const createdAt = typeof rec.createdAt === "string" ? rec.createdAt : undefined;
  return {
    ...rec,
    status: rec.status ?? "available",
    revokedAt: rec.revokedAt ?? null,
    revocationReason: rec.revocationReason ?? null,
    pinnedByMemoryIds: rec.pinnedByMemoryIds ?? [],
    transitions: rec.transitions ?? (createdAt ? [{ at: createdAt, kind: "created", actor: "system" }] : []),
  };
}
