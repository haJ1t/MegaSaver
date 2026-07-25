import { describe, expect, it } from "vitest";
import { canonicalSha256, deriveBenchmarkProjectionId } from "../src/lm2-benchmark-canonical.js";
import {
  BENCHMARK_DATA_REVISION,
  BENCHMARK_OFFICIAL_COMMIT,
  buildBenchmarkManifest,
  parseBenchmarkManifest,
} from "../src/lm2-benchmark-manifest.js";
import { embeddingInputDigest } from "../src/lm2-identity.js";

const checksums = {
  schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
  questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
  trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
  haystack: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
};

const stateTrajectory = {
  id: "trajectory-state",
  domain: "web",
  environment: "shop",
  goal: "inspect account",
  outcome: "success",
  start_url: "https://public.example",
  states: [
    { accessibility_tree: "", text: "e\u0301 status", timestamp: "2026-07-20T12:00:00+03:00" },
    { accessibility_tree: `${"x".repeat(49_999)}😀`, text: "ignored" },
  ],
};
const contentTrajectory = {
  id: "trajectory-content",
  content: [{ observation: { text: "approved request" } }],
};

function buildInput() {
  return {
    domain: "web" as const,
    tier: "small" as const,
    checksums,
    questions: [
      {
        id: "question-1",
        domain: "web",
        environment: "shop",
        question_type: "dynamic-environment",
        question: "What is the status?",
        image: null,
        answer: "private answer",
        eval_function: "private evaluator",
      },
    ],
    haystack: { "question-1": ["trajectory-state", "trajectory-content"] },
    trajectories: [stateTrajectory, contentTrajectory],
  };
}

describe("LM2 benchmark V1 manifest", () => {
  it("builds only allowlisted questions and exact public projections", () => {
    const manifest = buildBenchmarkManifest(buildInput());

    expect(manifest).toMatchObject({
      schemaVersion: "megasaver-lm2-manifest-v1",
      officialCommit: BENCHMARK_OFFICIAL_COMMIT,
      data: {
        repoId: "xiaowu0162/longmemeval-v2",
        revision: BENCHMARK_DATA_REVISION,
        checksums,
      },
      domain: "web",
      tier: "small",
    });
    expect(manifest.questions[0]).toEqual({
      questionId: "question-1",
      domain: "web",
      tier: "small",
      questionType: "dynamic-environment",
      questionText: "What is the status?",
      questionTextDigest: canonicalSha256("What is the status?"),
      imagePresent: false,
      trajectories: [
        { id: "trajectory-state", fullObjectDigest: canonicalSha256(stateTrajectory) },
        { id: "trajectory-content", fullObjectDigest: canonicalSha256(contentTrajectory) },
      ],
      haystackChainDigest: canonicalSha256([
        { id: "trajectory-state", fullObjectDigest: canonicalSha256(stateTrajectory) },
        { id: "trajectory-content", fullObjectDigest: canonicalSha256(contentTrajectory) },
      ]),
    });
    expect(JSON.stringify(manifest.questions[0])).not.toContain("private answer");
    expect(JSON.stringify(manifest.questions[0])).not.toContain("private evaluator");

    const first = manifest.trajectories[0]?.projections[0];
    expect(first).toMatchObject({
      kind: "state_snapshot",
      sourceKind: "states",
      sourceIndex: 0,
      text: "é status",
      observedAt: "2026-07-20T09:00:00.000Z",
      sourceDigest: canonicalSha256(stateTrajectory.states[0]),
      embeddingInputDigest: embeddingInputDigest({ kind: "state_snapshot", text: "é status" }),
    });
    expect(manifest.trajectories[0]?.projections[1]?.text).toBe("x".repeat(49_999));
    expect(manifest.trajectories[1]?.projections[0]?.observedAt).toBe("2000-01-01T00:00:00.002Z");
    expect(parseBenchmarkManifest(manifest)).toEqual(manifest);
  });

  it("rejects duplicate ids, unresolved references, and unknown question fields", () => {
    const duplicate = buildInput();
    duplicate.trajectories.push(stateTrajectory);
    expect(() => buildBenchmarkManifest(duplicate)).toThrow();

    const unresolved = buildInput();
    unresolved.haystack["question-1"] = ["missing"];
    expect(() => buildBenchmarkManifest(unresolved)).toThrow();

    const poisoned = buildInput();
    poisoned.questions[0] = { ...poisoned.questions[0], question_item: { answer: "secret" } };
    expect(() => buildBenchmarkManifest(poisoned)).toThrow();
  });

  it("binds each haystack checksum to its selected tier", () => {
    const mediumWithSmallHaystack = buildInput();
    mediumWithSmallHaystack.tier = "medium";
    expect(() => buildBenchmarkManifest(mediumWithSmallHaystack)).toThrow();

    const manifest = buildBenchmarkManifest(buildInput());
    const substituted = structuredClone(manifest);
    substituted.data.checksums.haystack =
      "4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59";
    expect(() => parseBenchmarkManifest(substituted)).toThrow();
  });

  it("rejects full-object mutation and unsupported projection shapes", () => {
    const invalid = buildInput();
    invalid.trajectories[1] = { id: "trajectory-content", content: [{}] } as never;
    expect(() => buildBenchmarkManifest(invalid)).toThrow();

    const manifest = buildBenchmarkManifest(buildInput());
    const mutated = structuredClone(manifest);
    const first = mutated.trajectories[0];
    if (first === undefined) throw new Error("Missing fixture trajectory.");
    first.fullObjectDigest = "0".repeat(64);
    expect(() => parseBenchmarkManifest(mutated)).toThrow();
  });

  it("rejects a valid UUIDv5 derived from the wrong projection frame", () => {
    const manifest = buildBenchmarkManifest(buildInput());
    const projection = manifest.trajectories[0]?.projections[0];
    if (projection === undefined) throw new Error("Missing fixture projection.");
    projection.sourceIndex = 1;
    projection.id = deriveBenchmarkProjectionId("foreign-trajectory", "states", 1);

    expect(() => parseBenchmarkManifest(manifest)).toThrow();
  });

  it("canonicalizes text exposed by the corpus truncation boundary", () => {
    const input = buildInput();
    const trajectoryId = "096432bf";
    const expectedText = `${"x".repeat(49_980)}der Fulfillment - 4`;
    input.domain = "enterprise";
    input.questions[0].domain = "enterprise";
    input.haystack["question-1"] = [trajectoryId];
    input.trajectories = [
      {
        id: trajectoryId,
        domain: "enterprise",
        states: [
          ...Array.from({ length: 12 }, (_, index) => ({ text: `state ${index}` })),
          { accessibility_tree: `${expectedText} Days (Pending - has not started)` },
        ],
      } as never,
    ];

    const manifest = buildBenchmarkManifest(input);
    const projection = manifest.trajectories[0]?.projections[12];

    expect(projection?.text).toBe(expectedText);
    expect(projection?.text.length).toBeLessThanOrEqual(50_000);
    expect(projection?.id).toBe(deriveBenchmarkProjectionId(trajectoryId, "states", 12));
    expect(projection?.embeddingInputDigest).toBe(
      embeddingInputDigest({ kind: "state_snapshot", text: expectedText }),
    );
  });
});
