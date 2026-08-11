import { checkConflicts } from "./conflict-checker.js";
import type { MemoryEntry } from "./memory-entry.js";
import { DECAY_HALF_LIFE_MS, isRecallable } from "./memory-entry.js";
import { verificationBadgeFor } from "./verification-badge.js";

export type DoctorSeverity = "info" | "warn" | "error";
export type DoctorCheck =
  | "stale-flagged"
  | "decayed"
  | "contradicted-by-code"
  | "rule-contradiction"
  | "lineage-conflict"
  | "suggestion-backlog"
  | "conflict-scan-truncated"
  | "hook-coverage"
  | "sync-freshness";

export type DoctorFinding = {
  check: DoctorCheck;
  severity: DoctorSeverity;
  message: string;
  evidence: { entryIds?: readonly string[]; files?: readonly string[] };
  repair: string;
};

export type MemoryHealthSummary = {
  total: number;
  recallableNow: number;
  suggested: number;
  staleFlagged: number;
};

export type MemoryHealthReport = {
  findings: DoctorFinding[];
  summary: MemoryHealthSummary;
};

export const DOCTOR_DECAYED_AGE_MS = 2 * DECAY_HALF_LIFE_MS;
export const DOCTOR_BACKLOG_WARN_COUNT = 10;
export const DOCTOR_BACKLOG_WARN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const DOCTOR_CONFLICT_SCAN_CAP = 200;

function ageMs(entry: MemoryEntry, now: string): number | null {
  const at = Date.parse(now);
  const raw = entry.lastActiveAt ?? entry.updatedAt ?? entry.createdAt;
  const ref = Date.parse(raw);
  if (Number.isNaN(at) || Number.isNaN(ref)) return null;
  return at - ref;
}

export function diagnoseMemoryHealth(
  entries: readonly MemoryEntry[],
  now: string,
): MemoryHealthReport {
  const findings: DoctorFinding[] = [];

  let recallableNow = 0;
  let suggested = 0;
  let staleFlagged = 0;

  for (const e of entries) {
    if (e.stale) staleFlagged += 1;
    if (e.approval === "suggested") suggested += 1;
    if (isRecallable(e, now)) recallableNow += 1;
  }

  // stale-flagged: one finding per stale entry
  for (const e of entries) {
    if (e.stale) {
      findings.push({
        check: "stale-flagged",
        severity: "warn",
        message: `stale memory ${e.id}`,
        evidence: { entryIds: [e.id] },
        repair: "mega memory sweep",
      });
    }
  }

  // decayed: approved+recallable, not stale, age > 2*half-life
  for (const e of entries) {
    if (e.stale) continue;
    if (e.approval !== "approved") continue;
    if (!isRecallable(e, now)) continue;
    const a = ageMs(e, now);
    if (a === null) continue;
    if (a > DOCTOR_DECAYED_AGE_MS) {
      const days = Math.floor(a / (24 * 60 * 60 * 1000));
      findings.push({
        check: "decayed",
        severity: "info",
        message: `decayed ${e.id} age ${days}d`,
        evidence: { entryIds: [e.id] },
        repair: "mega memory sweep",
      });
    }
  }

  // suggestion-backlog aggregate
  const suggestedEntries = entries.filter((e) => e.approval === "suggested");
  if (suggestedEntries.length > 0) {
    let oldestMs = Number.POSITIVE_INFINITY;
    for (const e of suggestedEntries) {
      const t = Date.parse(e.createdAt);
      if (!Number.isNaN(t) && t < oldestMs) oldestMs = t;
    }
    const oldestAgeMs = Number.isFinite(oldestMs) ? Date.parse(now) - oldestMs : 0;
    const isWarn =
      suggestedEntries.length >= DOCTOR_BACKLOG_WARN_COUNT ||
      oldestAgeMs >= DOCTOR_BACKLOG_WARN_AGE_MS;
    findings.push({
      check: "suggestion-backlog",
      severity: isWarn ? "warn" : "info",
      message: `suggestion backlog ${suggestedEntries.length} oldest ${Math.floor(oldestAgeMs / (24 * 60 * 60 * 1000))}d`,
      evidence: { entryIds: suggestedEntries.map((e) => e.id).slice(0, 5) },
      repair: "mega memory review",
    });
  }

  // contradicted-by-code: badge pass
  for (const e of entries) {
    if (verificationBadgeFor(e) === "contradicted-by-code") {
      findings.push({
        check: "contradicted-by-code",
        severity: "error",
        message: `contradicted ${e.id} head ${e.lastVerified?.headSha ?? "unknown"}`,
        evidence: { entryIds: [e.id] },
        repair: "mega memory verify",
      });
    }
  }

  // rule-contradiction via checkConflicts with cap and dedupe
  const recallableEntries = entries.filter(
    (e) => e.approval === "approved" && isRecallable(e, now),
  );
  // sort by lastActiveAt/updatedAt/createdAt descending, id tiebreak for deterministic cap
  const sortedForScan = [...recallableEntries].sort((a, b) => {
    const aRef = Date.parse(a.lastActiveAt ?? a.updatedAt ?? a.createdAt);
    const bRef = Date.parse(b.lastActiveAt ?? b.updatedAt ?? b.createdAt);
    if (aRef !== bRef) return bRef - aRef;
    return a.id.localeCompare(b.id);
  });
  const capped = sortedForScan.slice(0, DOCTOR_CONFLICT_SCAN_CAP);
  const isTruncated = recallableEntries.length > DOCTOR_CONFLICT_SCAN_CAP;
  if (isTruncated) {
    findings.push({
      check: "conflict-scan-truncated",
      severity: "info",
      message: `conflict scan truncated ${recallableEntries.length} > ${DOCTOR_CONFLICT_SCAN_CAP}`,
      evidence: {},
      repair: "narrow project scope or archive stale memories",
    });
  }
  const seenPairs = new Set<string>();
  for (const entry of capped) {
    const rest = capped.filter((x) => x.id !== entry.id);
    const result = checkConflicts(entry, rest);
    if (result.outcome === "contradiction") {
      const pairIds = [entry.id, ...result.conflictIds].sort();
      const key = pairIds.join("|");
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        findings.push({
          check: "rule-contradiction",
          severity: "warn",
          message: `rule contradiction ${pairIds.join(" ↔ ")}`,
          evidence: { entryIds: pairIds },
          repair: "mega memory reject",
        });
      }
    }
  }

  // lineage-conflict: supersedesId handling
  const byId = new Map<string, MemoryEntry>();
  for (const e of entries) byId.set(e.id, e);
  for (const e of entries) {
    if (e.approval !== "approved") continue;
    if (!e.supersedesId) continue;
    const target = byId.get(e.supersedesId);
    if (!target) {
      findings.push({
        check: "lineage-conflict",
        severity: "warn",
        message: `dangling supersedes ${e.id} -> ${e.supersedesId}`,
        evidence: { entryIds: [e.id] },
        repair: "mega memory history",
      });
    } else if (target.validTo == null && isRecallable(target, now)) {
      findings.push({
        check: "lineage-conflict",
        severity: "error",
        message: `supersession not closed ${e.id} supersedes ${target.id} still open`,
        evidence: { entryIds: [e.id, target.id] },
        repair: "mega memory history",
      });
    }
  }

  return {
    findings,
    summary: { total: entries.length, recallableNow, suggested, staleFlagged },
  };
}
