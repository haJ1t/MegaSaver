import { createHash } from "node:crypto";
import { embeddingInputDigest } from "./lm2-identity.js";
import type { Lm2Candidate } from "./lm2-model.js";

declare const planBrand: unique symbol;
export type Lm2IndexBatchPlan = { readonly [planBrand]: true };

type PlanProjection = {
  generation: number;
  candidates: readonly Lm2Candidate[];
  existingIds: readonly string[];
  missingIds: readonly string[];
};

type FrozenProjection = PlanProjection & {
  candidates: readonly Readonly<Lm2Candidate>[];
  batchNumber: number;
  identityDigest: string;
};

type PlanContext = {
  operationId: string;
  workspaceKey: string;
  modelFingerprint: string;
  deadlineAtMs: number;
};

function candidateIdentity(candidate: Lm2Candidate) {
  return {
    id: candidate.id,
    workspaceKey: candidate.workspaceKey,
    observedAt: candidate.observedAt,
    kind: candidate.kind,
    text: candidate.text,
    sourceDigest: candidate.sourceDigest,
    embeddingInputDigest: embeddingInputDigest({ kind: candidate.kind, text: candidate.text }),
  };
}

function projectionIdentity(projection: PlanProjection): string {
  return JSON.stringify({
    generation: projection.generation,
    candidates: projection.candidates.map(candidateIdentity),
    existingIds: [...projection.existingIds],
    missingIds: [...projection.missingIds],
  });
}

function candidateProjectionIdentity(projection: PlanProjection): string {
  return JSON.stringify({
    candidates: projection.candidates.map(candidateIdentity),
    existingIds: [...projection.existingIds],
    missingIds: [...projection.missingIds],
  });
}

function freezeProjection(input: PlanProjection, batchNumber: number, identityDigest: string) {
  const candidates = input.candidates.map((candidate) => Object.freeze({ ...candidate }));
  return Object.freeze({
    generation: input.generation,
    candidates: Object.freeze(candidates),
    existingIds: Object.freeze([...input.existingIds]),
    missingIds: Object.freeze([...input.missingIds]),
    batchNumber,
    identityDigest,
  });
}

function validProjection(input: PlanProjection): boolean {
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) return false;
  if (input.candidates.length === 0 || input.candidates.length > 16) return false;
  const candidateIds = input.candidates.map(({ id }) => id);
  if (new Set(candidateIds).size !== candidateIds.length) return false;
  if (new Set(input.existingIds).size !== input.existingIds.length) return false;
  if (new Set(input.missingIds).size !== input.missingIds.length) return false;
  const classified = [...input.existingIds, ...input.missingIds];
  return (
    classified.length === candidateIds.length &&
    classified.every((id) => candidateIds.includes(id)) &&
    candidateIds.every((id) => classified.includes(id))
  );
}

export function createLm2IndexPlanSequence(context: PlanContext) {
  const plans = new WeakMap<object, FrozenProjection>();
  let outstanding: object | null = null;
  const consumedProjections = new Set<string>();
  let nextBatchNumber = 0;
  let previousIdentityDigest = createHash("sha256")
    .update(
      JSON.stringify({
        operationId: context.operationId,
        workspaceKey: context.workspaceKey,
        modelFingerprint: context.modelFingerprint,
        deadlineAtMs: context.deadlineAtMs,
      }),
    )
    .digest("hex");

  return {
    mint(input: PlanProjection): Lm2IndexBatchPlan {
      if (outstanding !== null) throw new Error("LM2 batch plan is already outstanding.");
      if (!validProjection(input)) throw new Error("Invalid LM2 batch plan projection.");
      const projection = projectionIdentity(input);
      const candidateProjection = candidateProjectionIdentity(input);
      if (consumedProjections.has(candidateProjection))
        throw new Error("LM2 batch plan was already consumed.");
      if (input.candidates.some(({ workspaceKey }) => workspaceKey !== context.workspaceKey)) {
        throw new Error("LM2 batch plan workspace changed.");
      }
      const identityDigest = createHash("sha256")
        .update(
          JSON.stringify({
            operationId: context.operationId,
            batchNumber: nextBatchNumber,
            workspaceKey: context.workspaceKey,
            modelFingerprint: context.modelFingerprint,
            deadlineAtMs: context.deadlineAtMs,
            previousIdentityDigest,
            projection,
          }),
        )
        .digest("hex");
      const token = Object.freeze({}) as Lm2IndexBatchPlan;
      plans.set(token, freezeProjection(input, nextBatchNumber, identityDigest));
      outstanding = token;
      return token;
    },
    async consume<T>(
      token: Lm2IndexBatchPlan,
      attempt: PlanProjection & {
        now: number;
        egress(candidates: readonly Readonly<Lm2Candidate>[]): Promise<T> | T;
      },
    ): Promise<{ status: "rejected" } | { status: "consumed"; value: T }> {
      const frozen = plans.get(token);
      if (
        frozen === undefined ||
        outstanding !== token ||
        !Number.isFinite(attempt.now) ||
        attempt.now >= context.deadlineAtMs ||
        projectionIdentity(attempt) !== projectionIdentity(frozen)
      ) {
        return { status: "rejected" };
      }
      plans.delete(token);
      outstanding = null;
      nextBatchNumber = frozen.batchNumber + 1;
      previousIdentityDigest = frozen.identityDigest;
      consumedProjections.add(candidateProjectionIdentity(frozen));
      const missing = new Set(frozen.missingIds);
      const value = await attempt.egress(frozen.candidates.filter(({ id }) => missing.has(id)));
      return { status: "consumed", value };
    },
  };
}
