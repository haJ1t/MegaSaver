import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { MemoryEntryId } from "@megasaver/shared";
import { atomicWriteFile } from "./atomic-write.js";
import { backfillEvidenceRecord } from "./backfill.js";
import { digestContent } from "./digest.js";
import type { EvidenceStatus, RetentionClass, RevocationReason } from "./enums.js";
import { EvidenceLedgerError } from "./errors.js";
import { parseWorkspaceKey, recordPath, workspaceDir } from "./paths.js";
import type { ChunkDeletePort } from "./ports.js";
import { type EvidenceRecord, type EvidenceRecordInput, evidenceRecordSchema } from "./schema.js";
import { type SourceRef, type Transition, scrubSourceRef } from "./sub-schemas.js";

// Dependency-graph guard: the ledger cannot import @megasaver/policy. Callers
// supply redaction as a port so the ledger stays policy-agnostic.
export type SourceRefRedactor = (ref: SourceRef) => SourceRef;

function readRecord(storeRoot: string, workspaceKey: string, evidenceId: string): EvidenceRecord {
  const key = parseWorkspaceKey(workspaceKey);
  const path = recordPath(storeRoot, key, evidenceId);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new EvidenceLedgerError("not_found", "Evidence not found.");
  }
  let parsed: unknown;
  try {
    parsed = backfillEvidenceRecord(JSON.parse(text));
  } catch (cause) {
    throw new EvidenceLedgerError("store_corrupt", "Evidence record is corrupt.", { cause });
  }
  const result = evidenceRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new EvidenceLedgerError("store_corrupt", "Evidence record failed schema.", {
      cause: result.error,
    });
  }
  // Cross-workspace confusion guard (spec §6): the path encodes the key, but a
  // misplaced record must never be served under the wrong workspace.
  if (result.data.workspaceKey !== key) {
    throw new EvidenceLedgerError("workspace_mismatch", "Record workspaceKey does not match path.");
  }
  return result.data;
}

function writeRecord(storeRoot: string, rec: EvidenceRecord): void {
  atomicWriteFile(
    recordPath(storeRoot, rec.workspaceKey, rec.evidenceId),
    JSON.stringify(rec, null, 2),
  );
}

export async function appendEvidence(args: {
  storeRoot: string;
  // Required redaction port: the ledger cannot import @megasaver/policy, so
  // callers must supply a function that scrubs secret-bearing fields from the
  // sourceRef before it is persisted (spec §3 — stored sourceRef may never
  // contain an unredacted secret). Required (not optional) = compile-time
  // fail-closed: every caller must wire it.
  redactSourceRef: SourceRefRedactor;
  record: EvidenceRecordInput;
}): Promise<void> {
  const { redactedRawContent, redactedReturnedContent, ...rest } = args.record;
  const created: Transition = { at: rest.createdAt, kind: "created", actor: "system" };
  // Apply redaction port to sourceRef BEFORE schema parse — the stored record
  // must never contain an unredacted secret-bearing field.
  const redactedSourceRef =
    rest.sourceRef !== undefined ? args.redactSourceRef(rest.sourceRef) : rest.sourceRef;
  const full: unknown = {
    ...rest,
    ...(redactedSourceRef !== undefined ? { sourceRef: redactedSourceRef } : {}),
    rawDigest: digestContent(redactedRawContent),
    returnedDigest: digestContent(redactedReturnedContent),
    status: "available",
    revokedAt: null,
    revocationReason: null,
    pinnedByMemoryIds: [],
    transitions: [created],
  };
  const result = evidenceRecordSchema.safeParse(full);
  if (!result.success) {
    throw new EvidenceLedgerError("schema_invalid", "Evidence input failed schema.", {
      cause: result.error,
    });
  }
  // Fail closed: never persist evidence whose redaction left an unresolved
  // high-risk finding (the secret may still be present in chunk/sourceRef).
  if (result.data.redactionReport.unresolvedHighRisk) {
    throw new EvidenceLedgerError(
      "schema_invalid",
      "Cannot persist evidence with unresolved high-risk findings.",
    );
  }
  const path = recordPath(args.storeRoot, result.data.workspaceKey, result.data.evidenceId);
  if (existsSync(path)) {
    throw new EvidenceLedgerError("already_exists", "Evidence already exists (append-only).");
  }
  writeRecord(args.storeRoot, result.data);
}

export async function loadEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceRecord> {
  return readRecord(args.storeRoot, args.workspaceKey, args.evidenceId);
}

export async function getEvidenceStatus(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceStatus> {
  return (await loadEvidence(args)).status;
}

export interface EvidenceFilters {
  status?: EvidenceStatus;
  retentionClass?: RetentionClass;
}

export async function listEvidenceByWorkspace(args: {
  storeRoot: string;
  workspaceKey: string;
  filters?: EvidenceFilters;
}): Promise<readonly EvidenceRecord[]> {
  const key = parseWorkspaceKey(args.workspaceKey);
  const dir = workspaceDir(args.storeRoot, key);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const records: EvidenceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const rec = readRecord(args.storeRoot, key, name.slice(0, -".json".length));
    if (args.filters?.status && rec.status !== args.filters.status) continue;
    if (args.filters?.retentionClass && rec.retentionClass !== args.filters.retentionClass)
      continue;
    records.push(rec);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

// Build the object once with conditional spread — assigning to an optional
// property after construction violates `exactOptionalPropertyTypes` (TS2412).
function nowTransition(
  kind: Transition["kind"],
  extra: { memoryId?: MemoryEntryId; reason?: string } = {},
): Transition {
  return {
    at: new Date().toISOString(),
    kind,
    actor: "system",
    ...(extra.memoryId !== undefined ? { memoryId: extra.memoryId } : {}),
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
  };
}

export async function pinEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  memoryId: MemoryEntryId;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (rec.pinnedByMemoryIds.includes(args.memoryId)) return;
  // Pin is legal only from session (spec §5): keeps pin/unpin a clean round-trip.
  if (rec.retentionClass !== "session" || rec.status !== "available") {
    throw new EvidenceLedgerError(
      "invalid_transition",
      "Pin is only legal from an available session record.",
    );
  }
  const next = evidenceRecordSchema.parse({
    ...rec,
    retentionClass: "pinned",
    pinnedByMemoryIds: [...rec.pinnedByMemoryIds, args.memoryId],
    transitions: [...rec.transitions, nowTransition("pinned", { memoryId: args.memoryId })],
  });
  writeRecord(args.storeRoot, next);
}

export async function unpinEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  memoryId: MemoryEntryId;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (!rec.pinnedByMemoryIds.includes(args.memoryId)) return;
  const remaining = rec.pinnedByMemoryIds.filter((id) => id !== args.memoryId);
  const next = evidenceRecordSchema.parse({
    ...rec,
    retentionClass: remaining.length > 0 ? "pinned" : "session",
    pinnedByMemoryIds: remaining,
    transitions: [...rec.transitions, nowTransition("unpinned", { memoryId: args.memoryId })],
  });
  writeRecord(args.storeRoot, next);
}

export async function revokeEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
  reason: RevocationReason;
  deleteChunk: ChunkDeletePort;
  now: Date;
}): Promise<void> {
  const rec = await loadEvidence(args);
  if (rec.status === "revoked") return;
  const at = args.now.toISOString();
  // 1) Atomically tombstone FIRST (spec §4): null digests + chunk ref, scrub
  //    sourceRef, clear pins, reset retention off pinned. Fail-closed: worst
  //    case after this point is "revoked record, lingering chunk" (safe).
  const tombstone = evidenceRecordSchema.parse({
    ...rec,
    status: "revoked",
    rawDigest: null,
    returnedDigest: null,
    redactedRawChunkSetId: null,
    sourceRef: scrubSourceRef(),
    pinnedByMemoryIds: [],
    retentionClass: rec.retentionClass === "pinned" ? "session" : rec.retentionClass,
    revokedAt: at,
    revocationReason: args.reason,
    transitions: [
      ...rec.transitions,
      { at, kind: "revoked", actor: "system", reason: args.reason },
    ],
  });
  writeRecord(args.storeRoot, tombstone);
  // 2) Best-effort raw delete AFTER the tombstone is durable.
  if (rec.redactedRawChunkSetId !== null) {
    try {
      await args.deleteChunk(rec.redactedRawChunkSetId);
    } catch {
      // Best-effort; the tombstone already records the revocation.
    }
  }
}

export interface EvidenceExplanation {
  evidenceId: string;
  status: EvidenceStatus;
  rawExpandable: boolean;
  revocationReason: RevocationReason | null;
  policyVersion: string;
  pipelineVersion: string;
  createdAt: string;
}

export async function explainEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  evidenceId: string;
}): Promise<EvidenceExplanation> {
  const rec = await loadEvidence(args);
  return {
    evidenceId: rec.evidenceId,
    status: rec.status,
    rawExpandable: rec.status === "available" && rec.redactedRawChunkSetId !== null,
    revocationReason: rec.revocationReason,
    policyVersion: rec.policyVersion,
    pipelineVersion: rec.pipelineVersion,
    createdAt: rec.createdAt,
  };
}

export async function gcEvidence(args: {
  storeRoot: string;
  workspaceKey: string;
  now: Date;
  deleteChunk: ChunkDeletePort;
}): Promise<{ degraded: number }> {
  const all = await listEvidenceByWorkspace({
    storeRoot: args.storeRoot,
    workspaceKey: args.workspaceKey,
  });
  const at = args.now.toISOString();
  let degraded = 0;
  for (const rec of all) {
    if (rec.status !== "available") continue;
    // GC exemptions (spec §5): pinned and manual_hold survive ordinary GC.
    if (rec.retentionClass === "pinned" || rec.retentionClass === "manual_hold") continue;
    if (rec.expiresAt === null) continue;
    if (new Date(rec.expiresAt).getTime() > args.now.getTime()) continue;
    if (rec.redactedRawChunkSetId !== null) {
      try {
        await args.deleteChunk(rec.redactedRawChunkSetId);
      } catch {
        // Best-effort; still degrade the metadata below.
      }
    }
    const next = evidenceRecordSchema.parse({
      ...rec,
      status: "retained_metadata_only",
      redactedRawChunkSetId: null,
      transitions: [...rec.transitions, { at, kind: "raw_gc", actor: "system" }],
    });
    writeRecord(args.storeRoot, next);
    degraded += 1;
  }
  return { degraded };
}
