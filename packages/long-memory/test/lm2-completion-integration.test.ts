import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// biome-ignore format: The self-contained fixture is one integration scenario and must stay below the repository's 300-line test limit.
{
const benchmarkRoot = join(import.meta.dirname, "../../../benchmarks/longmemeval-v2");
const verifier = join(benchmarkRoot, "verify-official-artifacts.mjs");
const schemaPath = join(benchmarkRoot, "evidence-schema.json");
const roots: string[] = [];
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function artifact(root: string, path: string, value: unknown) {
  const bytes = typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { path, sha256: sha256(bytes) };
}
function runArtifacts(root: string, domain: "web" | "enterprise") {
  const questionId = `${domain}-question`;
  const base = `runs/${domain}`;
  const runArgsValue = {
    method: "megasaver_lm2_hybrid",
    domain,
    tier: "small",
    model: "Qwen/Qwen3.5-9B",
    evaluator_model: "gpt-5.2",
  };
  const metricsValue = {
    overall: { overall_full_set: 0.5, count_all_questions: 1 },
    non_abstention_by_category: { gotchas: { pct_correct: 0.5, count: 1 } },
    combined_abstention_by_category: {
      static: { pct_correct: 0.5, count: 1 },
      dynamic: { pct_correct: 0.5, count: 1 },
      procedure: { pct_correct: 0.5, count: 1 },
    },
    memory_query: { avg_seconds: 0.0125 },
  };
  const telemetryValue = {
    profile: "adaptive",
    semanticStatus: "used",
    modelFingerprint: "a".repeat(64),
    candidateCount: 1,
    selectionCount: 1,
    latencyMs: 12.5,
    questionId,
    questionType: "static",
    imagePresent: false,
    imageUsed: false,
  };
  const memoryConfigValue = { memory_type: "megasaver_lm2_hybrid", memory_params: {
    data_revision: "f152293e235517d504809563c833d7190b8c713b", profile: "adaptive", embedding_egress: "local",
    model: { provider: "local", modelId: "megasaver-hash-embedding", revision: "v1", dimensions: 64, embeddingInputVersion: "lm2-v1" },
  } };
  return {
    domain,
    tier: "small",
    command: "python",
    arguments: ["evaluation/harness.py", "--domain", domain, "--tier", "small"],
    outputDirectory: base,
    runArgs: artifact(root, `${base}/run_args.json`, runArgsValue),
    aggregatedMetrics: artifact(root, `${base}/aggregated_metrics.json`, metricsValue),
    perQuestion: {
      ...artifact(root, `${base}/per_question.jsonl`, { id: questionId, question_type: "static", memory_query_duration_seconds: 0.0125 }),
      rowCount: 1,
    },
    runtimeInputs: {
      questions: artifact(root, `${base}/runtime_inputs/questions.json`, [
        { id: questionId, domain, question_type: "static" },
      ]),
      haystack: artifact(root, `${base}/runtime_inputs/haystack.json`, {
        [questionId]: ["trajectory-1"],
      }),
      memoryConfig: artifact(root, `${base}/runtime_inputs/memory_config.json`, memoryConfigValue),
    },
    telemetry: {
      ...artifact(root, `${base}/telemetry/queries.jsonl`, telemetryValue),
      rowCount: 1,
    },
    rawLatencySamplesSeconds: [0.0125],
    failures: [],
  };
}
function createEvidenceFixture() {
  const root = mkdtempSync(join(tmpdir(), "megasaver-lm2-evidence-"));
  roots.push(root);
  const runs = [runArtifacts(root, "web"), runArtifacts(root, "enterprise")];
  const combinedValue = {
    overall: { overall_full_set: 0.5, count_all_questions: 2 },
    non_abstention_by_category: { gotchas: { pct_correct: 0.5, count: 2 } },
    combined_abstention_by_category: {
      static: { pct_correct: 0.5, count: 2 },
      dynamic: { pct_correct: 0.5, count: 2 },
      procedure: { pct_correct: 0.5, count: 2 },
    },
    memory_query: { avg_seconds: 0.0125 },
  };
  const combinedMetrics = artifact(root, "combined_metrics.json", combinedValue);
  const systemDescription = artifact(root, "inputs/SYSTEM_DESCRIPTION.md", "Mega Saver LM2\n");
  const codeArtifact = artifact(root, "inputs/megasaver_lm2_hybrid.py", "class Backend: pass\n");
  const packageDirectory = "leaderboard/megasaver_lm2";
  for (const run of runs) {
    for (const entry of [
      run.runArgs,
      run.aggregatedMetrics,
      run.perQuestion,
      run.runtimeInputs.questions,
      run.runtimeInputs.haystack,
      run.runtimeInputs.memoryConfig,
    ]) {
      const suffix = entry.path.slice(`runs/${run.domain}/`.length);
      const target = join(root, packageDirectory, "operating_points/balanced", run.domain, suffix);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, entry.path), target);
    }
  }
  artifact(root, `${packageDirectory}/SYSTEM_DESCRIPTION.md`, "Mega Saver LM2\n");
  artifact(root, `${packageDirectory}/megasaver_lm2_hybrid.py`, "class Backend: pass\n");
  artifact(root, `${packageDirectory}/submission_overview.json`, {
    submission_name: "megasaver_lm2",
    method: "megasaver_lm2_hybrid",
    tier: "small",
    operating_points: [{ name: "balanced", overall_full_set: 0.5 }],
  });
  artifact(root, `${packageDirectory}/operating_points/balanced/metric_overview.json`, {
    overall_full_set: 0.5,
    gotchas_accuracy: 0.5,
    static_accuracy: 0.5,
    dynamic_accuracy: 0.5,
    procedure_accuracy: 0.5,
    memory_query_avg_seconds: 0.0125,
  });
  artifact(root, `${packageDirectory}/operating_points/balanced/operating_point_metadata.json`, {
    submission_name: "megasaver_lm2",
    operating_point_name: "balanced",
    method: "megasaver_lm2_hybrid",
    tier: "small",
  });
  const packageFiles = execFileSync("find", [join(root, packageDirectory), "-type", "f"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((path) => ({
      path: path.slice(root.length + 1),
      sha256: sha256(readFileSync(path)),
    }));
  execFileSync("tar", ["-czf", join(root, "leaderboard/megasaver_lm2.tar.gz"), "megasaver_lm2"], {
    cwd: join(root, "leaderboard"),
  });
  const evidence = {
    schemaVersion: "megasaver-lm2-official-evidence-v1",
    official: {
      repository: "https://github.com/xiaowu0162/LongMemEval-V2",
      commit: "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
      data: {
        repoId: "xiaowu0162/longmemeval-v2",
        revision: "f152293e235517d504809563c833d7190b8c713b",
        preparationMode: "symlink",
        checksums: {
          schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
          questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
          trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
          haystack: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
        },
        validator: {
          command: "data/validate_data.py",
          arguments: ["--tier", "small"],
          exitCode: 0,
          stdoutSha256: "b".repeat(64),
        },
      },
    },
    installation: {
      preInstallState: "baseline",
      preInstallHashes: {
        "memory_modules/memory.py": "512d48d93ff78208127c85ffd90ea4c63f1f9ccea3427f0a7b6928a39bdc6a59",
        "evaluation/harness.py": "4a508fde65e382c45669fe7243348944628054c9ce6416d78c0a395ce1c3abcd",
        "leaderboard/build_submission_step_1_single_operating_point.py":
          "8c197c28231a14b303ec8a11a5cd5ddbbe70a5e9072f1f97c28f30f484d8f078",
        "leaderboard/build_submission_step_2_build_package.py":
          "ae727018666e7131d6f1415515405f51ab91365ac9929ad0990d083a8bcf4907",
      },
      postInstallDirtyPaths: ["memory_modules/megasaver_lm2_hybrid.py", "memory_modules/memory.py"],
      postInstallHashes: {
        "memory_modules/megasaver_lm2_hybrid.py": codeArtifact.sha256,
        "memory_modules/memory.py": "c".repeat(64),
      },
      postInstallDiffs: [
        { path: "memory_modules/megasaver_lm2_hybrid.py", sha256: codeArtifact.sha256 },
        { path: "memory_modules/memory.py", sha256: "d".repeat(64) },
      ],
    },
    configuration: {
      reader: { provider: "local-openai-compatible", model: "Qwen/Qwen3.5-9B", parameters: {} },
      judge: { provider: "openai", model: "gpt-5.2", parameters: { reasoning: "medium" } },
      embedding: { provider: "local", model: "megasaver-hash-embedding", egress: "local", parameters: { revision: "v1", dimensions: 64, embeddingInputVersion: "lm2-v1" } },
    },
    hardware: {
      capturedAt: "2026-07-20T00:00:00.000Z",
      os: "darwin",
      architecture: "arm64",
      cpuModel: "test-cpu",
      logicalCpuCount: 8,
      memoryBytes: 16_000_000_000,
      accelerators: [{ name: "test-gpu", memoryBytes: 8_000_000_000 }],
      software: { node: "22.0.0", python: "3.11.0" },
    },
    implementation: {
      megaSaverCommit: "e".repeat(40),
      adapter: codeArtifact,
      transport: artifact(root, "inputs/lm2-benchmark.js", "transport\n"),
    },
    runs,
    combined: {
      metrics: combinedMetrics,
      dashboard: {
        overallFullSet: 0.5,
        gotchasAccuracy: 0.5,
        staticAccuracy: 0.5,
        dynamicAccuracy: 0.5,
        procedureAccuracy: 0.5,
      },
    },
    leaderboard: {
      submissionName: "megasaver_lm2",
      operatingPointName: "balanced",
      systemDescription,
      codeArtifact,
      packageDirectory,
      packageFiles,
      submissionOverview: packageFiles.find((entry) => entry.path.endsWith("submission_overview.json")),
      tarball: {
        path: "leaderboard/megasaver_lm2.tar.gz",
        sha256: sha256(readFileSync(join(root, "leaderboard/megasaver_lm2.tar.gz"))),
      },
      step1: {
        exitCode: 0,
        arguments: ["runs/web", "runs/enterprise", "megasaver_lm2", "balanced", "small", "--method", "megasaver_lm2_hybrid", "--output-root", "leaderboard"],
      },
      step2: {
        exitCode: 0,
        arguments: ["megasaver_lm2", "inputs/SYSTEM_DESCRIPTION.md", "inputs/megasaver_lm2_hybrid.py", "leaderboard/megasaver_lm2/operating_points/balanced", "--output-root", "leaderboard"],
      },
    },
  };
  const evidencePath = join(root, "evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
  return { evidence, evidencePath, root };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("LM2 official-score evidence gate", () => {
  it("inspects every required evidence class without authorizing a score", () => {
    const fixture = createEvidenceFixture();
    const result = execFileSync(process.execPath, [verifier, "--inspect", "--evidence", fixture.evidencePath], {
      encoding: "utf8",
    });
    expect(JSON.parse(result)).toMatchObject({ valid: true, officialScoreEligible: false });
    expect(JSON.parse(readFileSync(schemaPath, "utf8")).$id).toBe("https://megasaver.dev/schemas/lm2-official-evidence-v1.json");
  });
  it.each([
    "official.data.validator",
    "installation.postInstallDiffs",
    "configuration.embedding",
    "hardware.cpuModel",
    "implementation.transport",
    "runs.0.telemetry",
    "runs.0.runtimeInputs.memoryConfig",
    "runs.0.rawLatencySamplesSeconds",
    "runs.0.failures",
    "combined.dashboard.procedureAccuracy",
    "leaderboard.tarball",
  ])("fails closed when %s is missing", (field) => {
    const fixture = createEvidenceFixture();
    let target: Record<string, unknown> | unknown[] = fixture.evidence as never;
    const parts = field.split(".");
    for (const part of parts.slice(0, -1)) target = target[Number.isNaN(Number(part)) ? part : Number(part)] as never;
    delete target[parts.at(-1) as never];
    writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence)}\n`);
    const result = spawnSync(process.execPath, [verifier, "--inspect", "--evidence", fixture.evidencePath], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Evidence gate failed");
  });
  it("never reports eligibility when full official revalidation cannot run", () => {
    const fixture = createEvidenceFixture();
    const result = spawnSync(process.execPath, [verifier, "--evidence", fixture.evidencePath, "--official-root", join(fixture.root, "missing"), "--data-root", join(fixture.root, "missing-data")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("officialScoreEligible\":true");
  });
});
}
