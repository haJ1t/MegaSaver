import { createHash } from "node:crypto";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";

export const MAX_LM2_QUOTA_LEDGER_BYTES = 64 * 1024;
export const MAX_LM2_PENDING_ALLOCATIONS = 16;
export const MAX_LM2_VECTOR_NAMESPACES = 2;
export const MAX_LM2_SIDECARS_PER_NAMESPACE = 10_000;
export const MAX_LM2_WORKSPACE_VECTOR_BYTES = 128 * 1024 * 1024;
export const LM2_PENDING_SIDECAR_RESERVATION_BYTES = 24 * 1024;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");
const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const safeIntegerSchema = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  z
    .number()
    .int()
    .min(minimum)
    .max(maximum)
    .refine((value) => !Object.is(value, -0), "must be a canonical nonnegative integer");
const nonnegativeSafeIntegerSchema = safeIntegerSchema(0);
const positiveSafeIntegerSchema = safeIntegerSchema(1);
const identityTextSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);
const sidecarNameSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value === value.normalize("NFC") &&
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\"),
    "must be a canonical basename",
  );

export function lm2PendingTemporaryName(operationId: string, allocationSequence: number): string {
  return `.lm2-${operationId}-${allocationSequence}.pending`;
}

const recordIdentityInputSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    id: lowercaseUuidSchema,
    kind: z.enum(["state_snapshot", "state_transition", "memory_entry"]),
    sourceDigest: sha256Schema,
    embeddingInputDigest: sha256Schema,
    modelFingerprint: sha256Schema,
  })
  .strict();
export type Lm2RecordIdentityInput = z.infer<typeof recordIdentityInputSchema>;

export function recordIdentityDigest(input: Lm2RecordIdentityInput): string {
  const parsed = recordIdentityInputSchema.parse(input);
  return createHash("sha256")
    .update(`megasaver.long-memory.lm2.record-identity.v1\0${JSON.stringify(parsed)}`, "utf8")
    .digest("hex");
}

export const lm2NamespaceAllocationSchema = z
  .object({
    modelFingerprint: sha256Schema,
    sidecarCount: safeIntegerSchema(1, MAX_LM2_SIDECARS_PER_NAMESPACE),
    serializedBytes: safeIntegerSchema(1, MAX_LM2_WORKSPACE_VECTOR_BYTES),
  })
  .strict();
export type Lm2NamespaceAllocation = z.infer<typeof lm2NamespaceAllocationSchema>;

export const lm2PendingAllocationSchema = z
  .object({
    allocationSequence: positiveSafeIntegerSchema,
    modelFingerprint: sha256Schema,
    recordId: lowercaseUuidSchema,
    recordIdentityDigest: sha256Schema,
    reservedBytes: z.literal(LM2_PENDING_SIDECAR_RESERVATION_BYTES),
    expectedSidecarDigest: sha256Schema.nullable(),
    serializedBytes: safeIntegerSchema(1, LM2_PENDING_SIDECAR_RESERVATION_BYTES).nullable(),
    temporaryName: sidecarNameSchema,
    finalName: sidecarNameSchema,
    phase: z.enum(["reserved", "materialized", "published"]),
  })
  .strict()
  .superRefine((entry, context) => {
    const hasDigest = entry.expectedSidecarDigest !== null;
    const hasBytes = entry.serializedBytes !== null;
    if (hasDigest !== hasBytes || (entry.phase === "reserved") !== !hasDigest) {
      context.addIssue({
        code: "custom",
        message: "sidecar digest and byte count must match the pending phase",
      });
    }
    if (entry.finalName !== `${entry.recordId}.json`) {
      context.addIssue({ code: "custom", message: "final name must match the record id" });
    }
    if (entry.temporaryName === entry.finalName) {
      context.addIssue({ code: "custom", message: "temporary name cannot reuse the final name" });
    }
  });
export type Lm2PendingAllocation = z.infer<typeof lm2PendingAllocationSchema>;

const lockIdentitySchema = z
  .object({
    device: identityTextSchema,
    inode: identityTextSchema,
  })
  .strict();

const activeOperationSchema = z
  .object({
    operationId: lowercaseUuidSchema,
    expectedGeneration: nonnegativeSafeIntegerSchema,
    lockIdentity: lockIdentitySchema,
    lockToken: sha256Schema,
  })
  .strict();

const pendingTransactionSchema = z
  .object({
    operationId: lowercaseUuidSchema,
    expectedGeneration: nonnegativeSafeIntegerSchema,
    firstAllocationSequence: positiveSafeIntegerSchema,
    lastAllocationSequence: positiveSafeIntegerSchema,
    entries: z.array(lm2PendingAllocationSchema).min(1).max(MAX_LM2_PENDING_ALLOCATIONS),
  })
  .strict();

export const lm2QuotaLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceKey: workspaceKeySchema,
    epoch: sha256Schema,
    lockIdentity: lockIdentitySchema,
    lockToken: sha256Schema,
    generation: nonnegativeSafeIntegerSchema,
    namespaces: z.array(lm2NamespaceAllocationSchema).max(MAX_LM2_VECTOR_NAMESPACES),
    committedThroughAllocation: nonnegativeSafeIntegerSchema,
    nextAllocationSequence: positiveSafeIntegerSchema,
    activeOperation: activeOperationSchema.nullable(),
    pending: pendingTransactionSchema.nullable(),
  })
  .strict()
  .superRefine((ledger, context) => {
    const fingerprints = ledger.namespaces.map((entry) => entry.modelFingerprint);
    if (
      fingerprints.some((value, index) => index > 0 && value <= (fingerprints[index - 1] ?? ""))
    ) {
      context.addIssue({
        code: "custom",
        message: "namespace summaries must be unique and sorted",
      });
    }
    if (
      ledger.committedThroughAllocation === Number.MAX_SAFE_INTEGER ||
      ledger.nextAllocationSequence !== ledger.committedThroughAllocation + 1
    ) {
      context.addIssue({
        code: "custom",
        message: "next allocation must follow the committed range",
      });
    }
    if (
      ledger.activeOperation !== null &&
      (ledger.activeOperation.expectedGeneration !== ledger.generation ||
        ledger.activeOperation.lockIdentity.device !== ledger.lockIdentity.device ||
        ledger.activeOperation.lockIdentity.inode !== ledger.lockIdentity.inode ||
        ledger.activeOperation.lockToken !== ledger.lockToken)
    ) {
      context.addIssue({ code: "custom", message: "active fence must match the permanent fence" });
    }
    const pending = ledger.pending;
    const committedSidecarCount = ledger.namespaces.reduce(
      (total, entry) => total + entry.sidecarCount,
      0,
    );
    if (committedSidecarCount !== ledger.committedThroughAllocation) {
      context.addIssue({
        code: "custom",
        message: "namespace counts must match the committed allocation watermark",
      });
    }
    const allocatedBytes = ledger.namespaces.reduce(
      (total, entry) => total + entry.serializedBytes,
      (pending?.entries.length ?? 0) * LM2_PENDING_SIDECAR_RESERVATION_BYTES,
    );
    if (!Number.isSafeInteger(allocatedBytes) || allocatedBytes > MAX_LM2_WORKSPACE_VECTOR_BYTES) {
      context.addIssue({ code: "custom", message: "ledger exceeds workspace byte quota" });
    }
    if (pending === null) return;
    const active = ledger.activeOperation;
    if (
      active === null ||
      active.operationId !== pending.operationId ||
      active.expectedGeneration !== ledger.generation ||
      pending.expectedGeneration !== ledger.generation
    ) {
      context.addIssue({ code: "custom", message: "pending allocation requires its active fence" });
    }
    if (
      pending.firstAllocationSequence !== ledger.nextAllocationSequence ||
      pending.lastAllocationSequence !==
        pending.firstAllocationSequence + pending.entries.length - 1 ||
      pending.entries.some(
        (entry, index) => entry.allocationSequence !== pending.firstAllocationSequence + index,
      )
    ) {
      context.addIssue({ code: "custom", message: "pending allocation range must be consecutive" });
    }
    if (
      pending.entries.some(
        (entry) =>
          entry.temporaryName !==
          lm2PendingTemporaryName(pending.operationId, entry.allocationSequence),
      )
    ) {
      context.addIssue({ code: "custom", message: "pending temporary name must match its fence" });
    }
    const identities = pending.entries.map((entry) => entry.recordIdentityDigest);
    const targets = pending.entries.map((entry) => `${entry.modelFingerprint}\0${entry.recordId}`);
    const temporaryNames = pending.entries.map((entry) => entry.temporaryName);
    const finalNames = new Set(pending.entries.map((entry) => entry.finalName));
    if (
      new Set(identities).size !== identities.length ||
      new Set(targets).size !== targets.length ||
      new Set(temporaryNames).size !== temporaryNames.length ||
      temporaryNames.some((name) => finalNames.has(name))
    ) {
      context.addIssue({ code: "custom", message: "pending identities and names must be unique" });
    }
    const namespaceCounts = new Map(
      ledger.namespaces.map((entry) => [entry.modelFingerprint, entry.sidecarCount]),
    );
    for (const entry of pending.entries) {
      namespaceCounts.set(
        entry.modelFingerprint,
        (namespaceCounts.get(entry.modelFingerprint) ?? 0) + 1,
      );
    }
    if (
      namespaceCounts.size > MAX_LM2_VECTOR_NAMESPACES ||
      [...namespaceCounts.values()].some((count) => count > MAX_LM2_SIDECARS_PER_NAMESPACE)
    ) {
      context.addIssue({ code: "custom", message: "pending allocation exceeds namespace quota" });
    }
  });
export type Lm2QuotaLedger = z.infer<typeof lm2QuotaLedgerSchema>;

export function serializeLm2QuotaLedger(input: Lm2QuotaLedger): string {
  return `${JSON.stringify(lm2QuotaLedgerSchema.parse(input))}\n`;
}
