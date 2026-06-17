import {
  type ConflictOutcome,
  type CoreRegistry,
  type MemoryApproval,
  type ValidationStatus,
  checkConflicts,
  validateSave,
} from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveEvidenceForMemory } from "../evidence-resolver.js";

export type ApproveMemoryEnv = { registry: CoreRegistry; storeRoot: string; now: () => string };

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
      // Cross-workspace or revoked evidence blocks approval immediately (fail-closed).
      if (resolution.hasCrossWorkspace || resolution.hasRevoked) {
        return {
          id: existing.id,
          approval: existing.approval, // still "suggested"
          validation: {
            status: "rejected",
            reasons: [
              ...(resolution.hasCrossWorkspace ? ["cross_workspace_evidence"] : []),
              ...(resolution.hasRevoked ? ["revoked_evidence"] : []),
            ],
          },
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
  return { id: updated.id, approval: updated.approval };
}
