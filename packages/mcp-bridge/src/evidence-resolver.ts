import { EvidenceLedgerError, type EvidenceRecord, loadEvidence } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey } from "@megasaver/shared";

export interface EvidenceResolution {
  records: readonly EvidenceRecord[];
  unresolvedSecret: boolean;
  hasRevoked: boolean;
  hasCrossWorkspace: boolean;
  missingIds: readonly string[];
}

export async function resolveEvidenceForMemory(args: {
  storeRoot: string;
  evidenceIds: readonly string[];
  projectRootPath: string;
}): Promise<EvidenceResolution> {
  const memoryWorkspaceKey = encodeWorkspaceKey(args.projectRootPath);
  const records: EvidenceRecord[] = [];
  const missingIds: string[] = [];
  let unresolvedSecret = false;
  let hasRevoked = false;
  let hasCrossWorkspace = false;

  for (const evidenceId of args.evidenceIds) {
    let record: EvidenceRecord;
    try {
      record = await loadEvidence({
        storeRoot: args.storeRoot,
        workspaceKey: memoryWorkspaceKey,
        evidenceId,
      });
    } catch (err) {
      if (err instanceof EvidenceLedgerError) {
        if (err.code === "not_found") {
          missingIds.push(evidenceId);
          continue;
        }
        if (err.code === "workspace_mismatch") {
          hasCrossWorkspace = true;
          continue;
        }
      }
      throw err;
    }

    // Belt-and-suspenders: store already throws workspace_mismatch, but the check is free.
    if (record.workspaceKey !== memoryWorkspaceKey) {
      hasCrossWorkspace = true;
    }
    if (record.status === "revoked") {
      hasRevoked = true;
    }
    if (record.redactionReport.unresolvedHighRisk) {
      unresolvedSecret = true;
    }
    records.push(record);
  }

  return { records, unresolvedSecret, hasRevoked, hasCrossWorkspace, missingIds };
}
