import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { workspaceKeySchema } from "@megasaver/shared";
import { createLm2Runtime, modelDescriptorFingerprint } from "./index.js";
import type { BenchmarkProjection } from "./lm2-benchmark-manifest.js";
import type { BenchmarkConfig } from "./lm2-benchmark-protocol.js";

function evidenceDigest(id: string): string {
  return createHash("sha256").update(`megasaver.lm2.benchmark.evidence.v1\0${id}`).digest("hex");
}

function hashVector(text: string, dimensions: number): number[] {
  const vector: number[] = Array.from({ length: dimensions }, () => 0);
  const tokens = text
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}_-]+/gu) ?? [text];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token, "utf8").digest();
    const slot = digest.readUInt32BE(0) % dimensions;
    vector[slot] = (vector[slot] as number) + ((digest[4] as number) % 2 === 0 ? 1 : -1);
  }
  if (!vector.some((value) => value !== 0)) vector[0] = 1;
  return vector;
}

function workspaceKey(
  config: BenchmarkConfig,
  instanceToken: string,
  sentinelToken: string,
): string {
  return createHash("sha256")
    .update(`${config.manifestDigest}\0${instanceToken}\0${sentinelToken}`)
    .digest("hex")
    .slice(0, 16);
}

export function createBenchmarkRuntime(input: {
  config: BenchmarkConfig;
  storeRoot: string;
  instanceToken: string;
  sentinelToken: string;
}) {
  const key = workspaceKeySchema.parse(
    workspaceKey(input.config, input.instanceToken, input.sentinelToken),
  );
  const fingerprint = modelDescriptorFingerprint(input.config.model);
  const evidence = new Map<string, string>();
  const runtime = createLm2Runtime({
    storeRoot: input.storeRoot,
    redaction: {
      version: "benchmark-public-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    },
    evidenceBinding: {
      async verify({ evidenceIds }) {
        return {
          evidence: evidenceIds.map((evidenceId) => ({
            evidenceId,
            evidenceDigest: evidence.get(evidenceId) ?? evidenceDigest(evidenceId),
          })),
        };
      },
    },
    evidenceEligibility: {
      async resolve({ evidenceIds }) {
        return evidenceIds.map((evidenceId) => ({
          evidenceId,
          workspaceKey: key,
          status: "available" as const,
          unresolvedHighRisk: false,
        }));
      },
    },
    clock: { now: () => new Date().toISOString() },
    monotonicClock: { now: () => performance.now() },
    embedding: {
      egress: "local",
      async embed({ texts }) {
        return {
          modelFingerprint: fingerprint,
          vectors: texts.map((text) => hashVector(text, input.config.model.dimensions)),
        };
      },
    },
    config: {
      admittedModels: [input.config.model],
      activeRecallModelFingerprint: fingerprint,
      embeddingEgress: "local",
      remoteApprovals: [],
      queryTimeoutMs: input.config.queryTimeoutMs,
      indexBatchTimeoutMs: input.config.indexBatchTimeoutMs,
    },
  });

  return {
    workspaceKey: key,
    async insert(projections: readonly BenchmarkProjection[]): Promise<void> {
      for (const projection of projections) {
        evidence.set(projection.id, projection.sourceDigest);
        const prepared = runtime.capture.prepare({
          workspaceKey: key,
          kind: "state_snapshot",
          observedAt: projection.observedAt,
          text: projection.text,
          action: null,
          evidenceIds: [projection.id],
          stateKey: `benchmark.${projection.id}`,
          representation: "value",
          supersedesSnapshotId: null,
        });
        await runtime.capture.capturePrepared({ prepared, authorization: "public-manifest" });
      }
      let cursor: string | undefined;
      for (;;) {
        const receipt = await runtime.index({
          workspaceKey: key,
          modelFingerprint: fingerprint,
          maxRecords: 256,
          ...(cursor === undefined ? {} : { cursor }),
          timeoutMs: input.config.indexBatchTimeoutMs,
        });
        if (receipt.outcome === "complete") return;
        if (receipt.outcome !== "continue") throw new Error("Benchmark indexing did not complete.");
        cursor = receipt.nextCursor;
      }
    },
    async query(task: string) {
      return runtime.recall({
        workspaceKey: key,
        task,
        tokenBudget: input.config.tokenBudget,
        profile: input.config.profile,
        timeoutMs: input.config.queryTimeoutMs,
      });
    },
  };
}
