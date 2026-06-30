import {
  type ConflictOutcome,
  type CoreRegistry,
  type MemoryApproval,
  type MemoryValidation,
  type ValidationStatus,
  checkConflicts,
  validateSave,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveEvidenceForMemory } from "../evidence-resolver.js";

export type ApproveMemoryEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  now: () => string;
  policyVersion?: string;
};

// `suggested` is deliberately NOT an accepted input: a memory cannot be moved
// back into the unapproved state via this tool — that is not an approval
// decision, and allowing it would let an agent reverse an approved memory out
// of the gate. approve_memory represents a HUMAN approval decision relayed
// through the agent; an autonomous agent self-approving its own
// save_memory(suggested) defeats the gate — by convention this is a
// human-in-the-loop action.
const approveMemoryInputSchema = z
  .object({
    memoryEntryId: z.string().min(1),
    approval: z.enum(["approved", "rejected"]).default("approved"),
  })
  .strict();

export interface ApproveMemoryResult {
  id: string;
  approval: MemoryApproval;
  validation?: { status: ValidationStatus; reasons: readonly string[] };
  conflict?: { outcome: ConflictOutcome; conflictIds: readonly MemoryEntryId[] };
}

export async function handleApproveMemory(
  env: ApproveMemoryEnv,
  rawArgs: unknown,
): Promise<ApproveMemoryResult> {
  const parsed = approveMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { memoryEntryId, approval } = parsed.data;
  const id = memoryEntryId as MemoryEntryId;

  const existing = env.registry.getMemoryEntry(id);
  if (existing === null) {
    throw new McpBridgeError("resource_not_found", `memory entry not found: ${memoryEntryId}`);
  }
  // True no-op: re-approving an already-approved memory must not churn updatedAt.
  if (existing.approval === approval) {
    return { id: existing.id, approval: existing.approval };
  }

  // Only an APPROVE decision is gated; a REJECT is always honoured (it proceeds
  // to the existing updateMemoryEntry flip below).
  if (approval === "approved") {
    const evidenceIds = existing.evidence ?? [];
    let unresolvedSecret = false;

    if (evidenceIds.length > 0) {
      const project = env.registry.getProject(existing.projectId);
      if (project === null) {
        throw new McpBridgeError("resource_not_found", `project not found: ${existing.projectId}`);
      }
      const resolution = await resolveEvidenceForMemory({
        storeRoot: env.storeRoot,
        evidenceIds,
        projectRootPath: project.rootPath,
      });
      // A cited evidenceId that resolves to no record means the memory points at
      // evidence that does not exist for a non-human author. The cited id is still
      // present in evidenceIds, so validateSave's presence check would pass it —
      // block here (fail-closed) before that check can be fooled. Human-authored
      // memories don't require resolvable evidence, so this only gates agents.
      const isHuman = existing.source === "manual";
      // Cross-workspace, revoked, or missing evidence blocks approval immediately
      // (fail-closed).
      const hasMissingRecord = !isHuman && resolution.missingIds.length > 0;
      if (resolution.hasCrossWorkspace || resolution.hasRevoked || hasMissingRecord) {
        const reasons = [
          ...(resolution.hasCrossWorkspace ? ["cross_workspace_evidence"] : []),
          ...(resolution.hasRevoked ? ["revoked_evidence"] : []),
          ...(hasMissingRecord ? ["missing_evidence_record"] : []),
        ];
        writeSidecar(env, existing.id as MemoryEntryId, {
          validationStatus: "rejected",
          reasons,
          conflictIds: [],
          validatedBy: "system",
        });
        return {
          id: existing.id,
          approval: existing.approval, // still "suggested"
          validation: { status: "rejected", reasons },
          conflict: { outcome: "unrelated", conflictIds: [] },
        };
      }
      unresolvedSecret = resolution.unresolvedSecret;
    }

    const validation = validateSave({ candidate: existing, evidenceIds, unresolvedSecret });
    // Spec §8 serialization guard: re-read the approved set immediately before
    // the flip — same synchronous critical section, no await between here and
    // updateMemoryEntry below. This ensures a prior approval of a conflicting
    // entry (A approved, then B attempted) is always visible to B's check.
    const approvedActive = env.registry
      .listMemoryEntries(existing.projectId)
      .filter((m) => m.approval === "approved" && !m.stale && m.id !== existing.id);
    const conflict = checkConflicts(existing, approvedActive);

    // spec §8: an exact duplicate of an approved memory must NOT become a second
    // approved row. Reject the suggested duplicate (kept for audit), do not flip.
    if (conflict.outcome === "duplicate") {
      const rejected = env.registry.updateMemoryEntry(existing.id, {
        approval: "rejected",
        updatedAt: env.now(),
      });
      writeSidecar(env, rejected.id as MemoryEntryId, {
        validationStatus: "rejected",
        reasons: conflict.reasons,
        conflictIds: conflict.conflictIds,
        validatedBy: "system",
      });
      return {
        id: rejected.id,
        approval: rejected.approval,
        validation: { status: "rejected", reasons: conflict.reasons },
        conflict: { outcome: conflict.outcome, conflictIds: conflict.conflictIds },
      };
    }
    // Any non-valid validation or any non-unrelated conflict blocks the flip: the
    // row stays `suggested` and the reasons are surfaced for the human to resolve.
    if (validation.status !== "valid" || conflict.outcome !== "unrelated") {
      writeSidecar(env, existing.id as MemoryEntryId, {
        validationStatus: validation.status,
        reasons: [...validation.reasons, ...conflict.reasons],
        conflictIds: conflict.conflictIds,
        validatedBy: "system",
      });
      return {
        id: existing.id,
        approval: existing.approval, // still "suggested"
        validation: {
          status: validation.status,
          reasons: [...validation.reasons, ...conflict.reasons],
        },
        conflict: { outcome: conflict.outcome, conflictIds: conflict.conflictIds },
      };
    }
  }
  // fall through to the existing updateMemoryEntry({ approval, updatedAt }) flip.

  const updated = env.registry.updateMemoryEntry(id, { approval, updatedAt: env.now() });
  // Bi-temporal supersession (M1): approving a memory that supersedes an older
  // one closes the old one's valid-time (validTo = now) so it drops out of
  // current-by-default recall. The old row is NOT deleted — kept for time-travel
  // (lossless). Only on approve; a reject leaves all validity untouched.
  if (approval === "approved" && updated.supersedesId !== undefined) {
    const superseded = env.registry.getMemoryEntry(updated.supersedesId as MemoryEntryId);
    if (superseded !== null && superseded.validTo == null) {
      env.registry.updateMemoryEntry(updated.supersedesId as MemoryEntryId, {
        validTo: env.now(),
        updatedAt: env.now(),
      });
    }
  }
  // Write sidecar: approved path → system valid, reject path → human rejected.
  writeSidecar(env, updated.id as MemoryEntryId, {
    validationStatus: approval === "rejected" ? "rejected" : "valid",
    reasons: [],
    conflictIds: [],
    validatedBy: approval === "rejected" ? "human" : "system",
  });
  return { id: updated.id, approval: updated.approval };
}

function writeSidecar(
  env: ApproveMemoryEnv,
  memoryEntryId: MemoryEntryId,
  fields: {
    validationStatus: MemoryValidation["validationStatus"];
    reasons: readonly string[];
    conflictIds: readonly MemoryEntryId[];
    validatedBy: "system" | "human";
  },
): void {
  const policyVersion = env.policyVersion ?? "1";
  env.registry.setMemoryValidation({
    memoryEntryId,
    validationStatus: fields.validationStatus,
    reasons: [...fields.reasons],
    conflictIds: [...fields.conflictIds],
    validatedAt: env.now(),
    validatedBy: fields.validatedBy,
    policyVersion,
  });
}
