// Read-boundary upgrade: rows written before the lifecycle fields existed get
// neutral defaults so existing on-disk evidence keeps loading. Mirrors the
// `backfillMemoryEntry` pattern in @megasaver/core.
export function backfillEvidenceRecord(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") {
    return raw;
  }
  const rec = raw as {
    createdAt?: unknown;
    status?: unknown;
    revokedAt?: unknown;
    revocationReason?: unknown;
    pinnedByMemoryIds?: unknown;
    transitions?: unknown;
  };
  if (
    rec.status !== undefined &&
    rec.transitions !== undefined &&
    rec.pinnedByMemoryIds !== undefined
  ) {
    return rec;
  }
  const createdAt = typeof rec.createdAt === "string" ? rec.createdAt : undefined;
  return {
    ...(raw as Record<string, unknown>),
    status: rec.status ?? "available",
    revokedAt: rec.revokedAt ?? null,
    revocationReason: rec.revocationReason ?? null,
    pinnedByMemoryIds: rec.pinnedByMemoryIds ?? [],
    transitions:
      rec.transitions ?? (createdAt ? [{ at: createdAt, kind: "created", actor: "system" }] : []),
  };
}
