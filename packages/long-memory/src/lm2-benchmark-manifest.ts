import { z } from "zod";
import {
  canonicalSha256,
  deriveBenchmarkProjectionId,
  truncateUtf16,
} from "./lm2-benchmark-canonical.js";
import { embeddingInputDigest } from "./lm2-identity.js";

export const BENCHMARK_OFFICIAL_COMMIT = "6f020ac2fc3275e46c706d3406e02c3ed79b7be2";
export const BENCHMARK_DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b";
export const BENCHMARK_REPO_ID = "xiaowu0162/longmemeval-v2";
export const BENCHMARK_MANIFEST_VERSION = "megasaver-lm2-manifest-v1";
export const BENCHMARK_PROJECTION_NAMESPACE = "7d20f05d-6a18-52b8-98e0-8f6c933b3484";
export const BENCHMARK_MAX_TEXT_CODE_UNITS = 50_000;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const checksumSchema = z
  .object({
    schema: z.literal("0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f"),
    questions: z.literal("0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7"),
    trajectories: z.literal("363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6"),
    haystack: z.enum([
      "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
      "4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59",
    ]),
  })
  .strict();
const trajectoryRefSchema = z
  .object({ id: z.string().trim().min(1), fullObjectDigest: sha256Schema })
  .strict();
const projectionSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase()),
    kind: z.literal("state_snapshot"),
    sourceKind: z.enum(["states", "content"]),
    sourceIndex: z.number().int().nonnegative(),
    text: z.string().min(1).max(BENCHMARK_MAX_TEXT_CODE_UNITS),
    observedAt: z.string().datetime({ offset: true }),
    sourceDigest: sha256Schema,
    embeddingInputDigest: sha256Schema,
  })
  .strict();
const trajectorySchema = trajectoryRefSchema
  .extend({ projections: z.array(projectionSchema).min(1) })
  .strict();
const questionSchema = z
  .object({
    questionId: z.string().trim().min(1),
    domain: z.enum(["web", "enterprise"]),
    tier: z.enum(["small", "medium"]),
    questionType: z.string().trim().min(1),
    questionText: z.string().trim().min(1),
    questionTextDigest: sha256Schema,
    imagePresent: z.boolean(),
    trajectories: z.array(trajectoryRefSchema),
    haystackChainDigest: sha256Schema,
  })
  .strict();
export const benchmarkManifestSchema = z
  .object({
    schemaVersion: z.literal(BENCHMARK_MANIFEST_VERSION),
    officialCommit: z.literal(BENCHMARK_OFFICIAL_COMMIT),
    data: z
      .object({
        repoId: z.literal(BENCHMARK_REPO_ID),
        revision: z.literal(BENCHMARK_DATA_REVISION),
        checksums: checksumSchema,
      })
      .strict(),
    domain: z.enum(["web", "enterprise"]),
    tier: z.enum(["small", "medium"]),
    questions: z.array(questionSchema).min(1),
    trajectories: z.array(trajectorySchema).min(1),
  })
  .strict();
export type BenchmarkManifest = z.infer<typeof benchmarkManifestSchema>;
export type BenchmarkProjection = z.infer<typeof projectionSchema>;

const officialQuestionSchema = z
  .object({
    id: z.string().trim().min(1),
    domain: z.enum(["web", "enterprise"]),
    environment: z.string(),
    question_type: z.string().trim().min(1),
    question: z.string().trim().min(1),
    image: z.string().nullable(),
    answer: z.unknown(),
    eval_function: z.unknown(),
  })
  .strict();

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/u.test(value)) {
    return null;
  }
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? null : time.toISOString();
}

function firstTimestamp(value: Record<string, unknown>): string | null {
  for (const nested of Object.values(value)) {
    const timestamp = canonicalTimestamp(nested);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function projectionText(sourceKind: "states" | "content", value: unknown): string {
  const source = z
    .object({
      accessibility_tree: z.unknown().optional(),
      text: z.unknown().optional(),
      observation: z.unknown().optional(),
    })
    .passthrough()
    .parse(value);
  let text: unknown;
  if (sourceKind === "states") {
    text =
      typeof source.accessibility_tree === "string" && source.accessibility_tree.trim()
        ? source.accessibility_tree
        : source.text;
  } else {
    const observation = z
      .object({ text: z.unknown().optional() })
      .passthrough()
      .parse(source.observation);
    text = observation.text;
  }
  if (typeof text !== "string" || !text.trim()) throw new Error("Projection text is missing.");
  return truncateUtf16(text.normalize("NFC").trim(), BENCHMARK_MAX_TEXT_CODE_UNITS);
}

function projectTrajectory(
  trajectory: Record<string, unknown> & { id?: unknown; states?: unknown; content?: unknown },
  ordinal: { value: number },
): BenchmarkManifest["trajectories"][number] {
  const id = z.string().trim().min(1).parse(trajectory.id);
  const sourceKind: "states" | "content" = Object.hasOwn(trajectory, "states")
    ? "states"
    : "content";
  const rows = z.array(z.unknown()).min(1).parse(trajectory[sourceKind]);
  const projections = rows.map((source, sourceIndex) => {
    const record = z.record(z.unknown()).parse(source);
    const text = projectionText(sourceKind, source);
    const observedAt =
      firstTimestamp(record) ?? new Date(Date.UTC(2000, 0, 1) + ordinal.value).toISOString();
    ordinal.value += 1;
    return {
      id: deriveBenchmarkProjectionId(id, sourceKind, sourceIndex),
      kind: "state_snapshot" as const,
      sourceKind,
      sourceIndex,
      text,
      observedAt,
      sourceDigest: canonicalSha256(source),
      embeddingInputDigest: embeddingInputDigest({ kind: "state_snapshot", text }),
    };
  });
  return { id, fullObjectDigest: canonicalSha256(trajectory), projections };
}

export function parseBenchmarkManifest(value: unknown): BenchmarkManifest {
  const manifest = benchmarkManifestSchema.parse(value);
  const trajectoryIds = new Set<string>();
  const trajectoryDigests = new Map<string, string>();
  for (const trajectory of manifest.trajectories) {
    if (trajectoryIds.has(trajectory.id)) throw new Error("Duplicate manifest trajectory id.");
    trajectoryIds.add(trajectory.id);
    trajectoryDigests.set(trajectory.id, trajectory.fullObjectDigest);
    for (const projection of trajectory.projections) {
      if (
        projection.embeddingInputDigest !==
        embeddingInputDigest({ kind: projection.kind, text: projection.text })
      ) {
        throw new Error("Projection embedding digest mismatch.");
      }
    }
  }
  const questionIds = new Set<string>();
  for (const question of manifest.questions) {
    if (
      questionIds.has(question.questionId) ||
      question.domain !== manifest.domain ||
      question.tier !== manifest.tier ||
      question.questionTextDigest !== canonicalSha256(question.questionText) ||
      question.haystackChainDigest !== canonicalSha256(question.trajectories) ||
      question.trajectories.some(
        (entry) => trajectoryDigests.get(entry.id) !== entry.fullObjectDigest,
      )
    ) {
      throw new Error("Invalid manifest question binding.");
    }
    questionIds.add(question.questionId);
  }
  return manifest;
}

export function buildBenchmarkManifest(input: {
  domain: "web" | "enterprise";
  tier: "small" | "medium";
  checksums: unknown;
  questions: readonly unknown[];
  haystack: Readonly<Record<string, readonly string[]>>;
  trajectories: readonly unknown[];
}): BenchmarkManifest {
  const checksums = checksumSchema.parse(input.checksums);
  const questions = input.questions.map((question) => officialQuestionSchema.parse(question));
  const trajectoryObjects = input.trajectories.map(
    (trajectory) =>
      z.record(z.unknown()).parse(trajectory) as Record<string, unknown> & {
        id?: unknown;
        states?: unknown;
        content?: unknown;
      },
  );
  const ids = new Set<string>();
  for (const trajectory of trajectoryObjects) {
    const id = z.string().trim().min(1).parse(trajectory.id);
    if (ids.has(id)) throw new Error("Duplicate trajectory id.");
    ids.add(id);
  }
  const referenced = new Set(
    questions
      .filter((question) => question.domain === input.domain)
      .flatMap((question) => input.haystack[question.id] ?? []),
  );
  const ordinal = { value: 0 };
  const trajectories = trajectoryObjects
    .filter((trajectory) => referenced.has(trajectory.id as string))
    .map((trajectory) => projectTrajectory(trajectory, ordinal));
  const byId = new Map(trajectories.map((trajectory) => [trajectory.id, trajectory]));
  const manifestQuestions = questions
    .filter((question) => question.domain === input.domain)
    .map((question) => {
      const haystack = input.haystack[question.id];
      if (haystack === undefined) throw new Error("Question has no haystack.");
      const trajectoryRefs = haystack.map((id) => {
        const trajectory = byId.get(id);
        if (trajectory === undefined) throw new Error("Haystack trajectory is unresolved.");
        return { id, fullObjectDigest: trajectory.fullObjectDigest };
      });
      return {
        questionId: question.id,
        domain: input.domain,
        tier: input.tier,
        questionType: question.question_type,
        questionText: question.question.normalize("NFC").trim(),
        questionTextDigest: canonicalSha256(question.question.normalize("NFC").trim()),
        imagePresent: question.image !== null,
        trajectories: trajectoryRefs,
        haystackChainDigest: canonicalSha256(trajectoryRefs),
      };
    });
  return parseBenchmarkManifest({
    schemaVersion: BENCHMARK_MANIFEST_VERSION,
    officialCommit: BENCHMARK_OFFICIAL_COMMIT,
    data: { repoId: BENCHMARK_REPO_ID, revision: BENCHMARK_DATA_REVISION, checksums },
    domain: input.domain,
    tier: input.tier,
    questions: manifestQuestions,
    trajectories,
  });
}
