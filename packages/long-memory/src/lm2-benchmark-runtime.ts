import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { workspaceKeySchema } from "@megasaver/shared";
import { Lm2BenchmarkContextBuilder } from "./lm2-benchmark-context.js";
import type { BenchmarkProjection } from "./lm2-benchmark-manifest.js";
import type { BenchmarkConfig } from "./lm2-benchmark-protocol.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import type { EmbeddingPort, Lm2Candidate } from "./lm2-model.js";
import { rankLm2Candidates } from "./lm2-ranker.js";
import { createLm2VectorStore } from "./lm2-vector-store.js";

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

function publicCandidates(
  key: Lm2Candidate["workspaceKey"],
  projections: readonly BenchmarkProjection[],
): Lm2Candidate[] {
  return projections.map((projection) => ({
    id: projection.id,
    workspaceKey: key,
    observedAt: projection.observedAt,
    kind: projection.kind,
    text: projection.text,
    sourceDigest: projection.sourceDigest,
  }));
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
  const vectors = createLm2VectorStore({ storeRoot: input.storeRoot });
  const embedding: EmbeddingPort = {
    egress: "local",
    async embed({ texts }) {
      return {
        modelFingerprint: fingerprint,
        vectors: texts.map((text) => hashVector(text, input.config.model.dimensions)),
      };
    },
  };
  const context = new Lm2BenchmarkContextBuilder();

  return {
    workspaceKey: key,
    async insert(projections: readonly BenchmarkProjection[]): Promise<void> {
      const result = await vectors.reserveAndPublish({
        workspaceKey: key,
        model: input.config.model,
        records: publicCandidates(key, projections),
        signal: new AbortController().signal,
        embed: embedding.embed,
      });
      if (result.reason !== null) throw new Error("Benchmark indexing did not complete.");
    },
    async query(task: string, projections: readonly BenchmarkProjection[]) {
      const candidates = publicCandidates(key, projections);
      const rank = await rankLm2Candidates({
        candidates,
        request: {
          workspaceKey: key,
          task,
          profile: input.config.profile,
          ...(input.config.profile === "adaptive" ? { model: input.config.model } : {}),
          timeoutMs: input.config.queryTimeoutMs,
        },
        vectors,
        embedding,
        clock: { now: () => performance.now() },
        adaptiveCandidateScope: "benchmark_run_cache",
      });
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const orderedCandidates = rank.scores.map(({ id, score }) => {
        const candidate = byId.get(id);
        if (candidate === undefined) throw new Error("Benchmark rank result is invalid.");
        return { candidate, score };
      });
      const built = context.build({
        workspaceKey: key,
        tokenBudget: input.config.tokenBudget,
        orderedCandidates,
      });
      return { ...built, receipt: { context: built.receipt, hybrid: rank.hybrid } };
    },
  };
}
