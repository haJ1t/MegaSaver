import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalSha256 } from "./lm2-benchmark-canonical.js";
import {
  appendBenchmarkTelemetry,
  assertBenchmarkRunIdentity,
  createBenchmarkRun,
  readBenchmarkManifest,
  replaceBenchmarkControl,
  withBenchmarkRunLock,
} from "./lm2-benchmark-files.js";
import type { BenchmarkManifest } from "./lm2-benchmark-manifest.js";
import { type BenchmarkRequest, BenchmarkTransportError } from "./lm2-benchmark-protocol.js";
import { createBenchmarkRuntime } from "./lm2-benchmark-runtime.js";

function nextTrajectory(input: {
  manifest: BenchmarkManifest;
  chain: readonly { id: string; fullObjectDigest: string }[];
  id: string;
  digest: string;
}) {
  const expected = input.manifest.questions.some(
    (question) =>
      input.chain.every(
        (entry, index) =>
          question.trajectories[index]?.id === entry.id &&
          question.trajectories[index]?.fullObjectDigest === entry.fullObjectDigest,
      ) &&
      question.trajectories[input.chain.length]?.id === input.id &&
      question.trajectories[input.chain.length]?.fullObjectDigest === input.digest,
  );
  const trajectory = input.manifest.trajectories.find(
    (entry) => entry.id === input.id && entry.fullObjectDigest === input.digest,
  );
  if (!expected || trajectory === undefined) throw new BenchmarkTransportError("state_rejected");
  return trajectory;
}

function admittedQuestion(input: {
  manifest: BenchmarkManifest;
  questionId: string;
  query: string;
  chainDigest: string;
}) {
  const question = input.manifest.questions.find(
    (entry) =>
      entry.questionId === input.questionId &&
      entry.questionText === input.query.normalize("NFC").trim() &&
      entry.questionTextDigest === canonicalSha256(input.query.normalize("NFC").trim()) &&
      entry.haystackChainDigest === input.chainDigest,
  );
  if (question === undefined) throw new BenchmarkTransportError("query_rejected");
  return question;
}

export async function runBenchmarkOperation(request: BenchmarkRequest): Promise<unknown> {
  const manifest = readBenchmarkManifest(request.config);
  if (request.op === "open") {
    const control = createBenchmarkRun(request);
    return {
      instanceToken: control.instanceToken,
      sentinelToken: control.sentinelToken,
      chainDigest: control.chainDigest,
      insertedCount: 0,
    };
  }
  return withBenchmarkRunLock({
    ...request,
    async run(handle, control) {
      if (control.chainDigest !== request.expectedChainDigest) {
        throw new BenchmarkTransportError("state_rejected");
      }
      if (request.op === "insert") {
        const id = Object.getOwnPropertyDescriptor(request.trajectory, "id")?.value;
        if (typeof id !== "string" || !id.trim()) {
          throw new BenchmarkTransportError("invalid_request");
        }
        const digest = canonicalSha256(request.trajectory);
        const trajectory = nextTrajectory({ manifest, chain: control.chain, id, digest });
        assertBenchmarkRunIdentity(handle);
        const runtime = createBenchmarkRuntime({
          config: request.config,
          storeRoot: join(handle.root.path, "cache"),
          instanceToken: request.instanceToken,
          sentinelToken: request.sentinelToken,
        });
        await runtime.insert(trajectory.projections);
        assertBenchmarkRunIdentity(handle);
        const chain = [...control.chain, { id, fullObjectDigest: digest }];
        const next = { ...control, chain, chainDigest: canonicalSha256(chain) };
        replaceBenchmarkControl(handle, next);
        return {
          chainDigest: next.chainDigest,
          insertedCount: chain.length,
          indexingComplete: true,
        };
      }
      const question = admittedQuestion({
        manifest,
        questionId: request.questionId,
        query: request.query,
        chainDigest: control.chainDigest,
      });
      const runtime = createBenchmarkRuntime({
        config: request.config,
        storeRoot: join(handle.root.path, "cache"),
        instanceToken: request.instanceToken,
        sentinelToken: request.sentinelToken,
      });
      const started = performance.now();
      const recalled = await runtime.query(request.query);
      const latencyMs = performance.now() - started;
      const items = recalled.items
        .filter((item) => item.type === "text" && item.value.trim())
        .map((item) => ({ type: "text" as const, value: item.value }));
      const telemetry = {
        profile: request.config.profile,
        semanticStatus: recalled.receipt.hybrid.semanticStatus,
        modelFingerprint: canonicalSha256(request.config.model),
        candidateCount: recalled.receipt.hybrid.fusedCandidateCount,
        selectionCount: items.length,
        latencyMs,
        questionId: question.questionId,
        questionType: question.questionType,
        imagePresent: request.queryImagePresent,
        imageUsed: false,
      };
      appendBenchmarkTelemetry(handle, telemetry);
      return { items, telemetry };
    },
  });
}
