import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type {
  EmbeddingPort,
  Lm2RuntimeConfig,
  ModelDescriptor,
  RemoteEmbeddingApprovalPort,
} from "../src/lm2-model.js";

export const workspaceKey = "0123456789abcdef";
export const evidenceId = "11111111-1111-4111-8111-111111111111";
export const primaryModel: ModelDescriptor = {
  provider: "local",
  modelId: "primary",
  revision: "r1",
  dimensions: 2,
  embeddingInputVersion: "lm2-v1",
};
export const secondaryModel: ModelDescriptor = {
  ...primaryModel,
  modelId: "secondary",
};

const roots: string[] = [];

export function createRuntimeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-runtime-")));
  roots.push(root);
  return root;
}

export function cleanupRuntimeRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function runtimeConfig(input?: {
  egress?: "local" | "remote";
  admittedModels?: readonly ModelDescriptor[];
  activeModel?: ModelDescriptor;
  approvals?: Lm2RuntimeConfig["remoteApprovals"];
}): Lm2RuntimeConfig {
  const admittedModels = [...(input?.admittedModels ?? [primaryModel])];
  const activeModel = input?.activeModel ?? admittedModels[0] ?? primaryModel;
  return {
    admittedModels,
    activeRecallModelFingerprint: modelDescriptorFingerprint(activeModel),
    embeddingEgress: input?.egress ?? "local",
    remoteApprovals: [...(input?.approvals ?? [])],
    queryTimeoutMs: 1_500,
    indexBatchTimeoutMs: 15_000,
  };
}

export function lm1Ports() {
  return {
    redaction: {
      version: "redaction-v1",
      redact: ({ text, action }: { text: string; action: string | null }) => ({
        text,
        action,
        unresolvedHighRisk: false,
      }),
    },
    evidenceBinding: {
      verify: vi.fn(async ({ evidenceIds }: { evidenceIds: readonly string[] }) => ({
        evidence: evidenceIds.map((id) => ({ evidenceId: id, evidenceDigest: "a".repeat(64) })),
      })),
    },
    evidenceEligibility: {
      resolve: vi.fn(async ({ evidenceIds }: { evidenceIds: readonly string[] }) =>
        evidenceIds.map((id) => ({
          evidenceId: id,
          workspaceKey,
          status: "available" as const,
          unresolvedHighRisk: false,
        })),
      ),
    },
  };
}

export function localEmbedding(): EmbeddingPort {
  return {
    egress: "local",
    embed: vi.fn(async ({ texts }) => ({
      modelFingerprint: modelDescriptorFingerprint(primaryModel),
      vectors: texts.map(() => [1, 0]),
    })),
  };
}

export function remoteApproval(
  result: "approved" | "denied" | "revoked" | "unreadable" = "approved",
): RemoteEmbeddingApprovalPort {
  return { assertCurrent: vi.fn(async () => result) };
}

export function snapshotInput(index: number, text: string, observedAt: string) {
  return {
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt,
    text,
    action: null,
    evidenceIds: [evidenceId],
    stateKey: `runtime.state.${index}`,
    representation: "value" as const,
    supersedesSnapshotId: null,
  };
}
