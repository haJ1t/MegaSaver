import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../src/lm2-benchmark-canonical.js";
import { buildBenchmarkManifest } from "../src/lm2-benchmark-manifest.js";

export const benchmarkRoot = join(import.meta.dirname, "../../../benchmarks/longmemeval-v2");
export const verifier = join(benchmarkRoot, "verify-official-artifacts.mjs");
export const schemaPath = join(benchmarkRoot, "evidence-schema.json");
const roots: string[] = [];
const DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b";
const MEGA_COMMIT = "e".repeat(40);
const checksums = {
  schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
  questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
  trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
  haystack: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
};

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function artifact(root: string, path: string, value: unknown) {
  const bytes = typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { path, sha256: sha256(bytes) };
}

function runArtifacts(
  root: string,
  domain: "web" | "enterprise",
  transportCommand: readonly string[],
) {
  const questionId = `${domain}-question`;
  const base = `runs/${domain}`;
  const trajectory = {
    id: `${domain}-trajectory-1`,
    states: [{ accessibility_tree: `${domain} billing status is paid` }],
  };
  const question = {
    id: questionId,
    domain,
    environment: "shop",
    question_type: "static-environment",
    question: "What is the billing status?",
    image: null,
    answer: "paid",
    eval_function: "private",
  };
  const { image: _image, ...runtimeQuestion } = question;
  const manifest = buildBenchmarkManifest({
    domain,
    tier: "small",
    checksums,
    questions: [question],
    haystack: { [questionId]: [trajectory.id] },
    trajectories: [trajectory],
  });
  const manifestPath = join(root, `${base}/runtime_inputs/megasaver-lm2-manifest-v1.json`);
  const manifestArtifact = artifact(
    root,
    `${base}/runtime_inputs/megasaver-lm2-manifest-v1.json`,
    `${canonicalJson(manifest)}\n`,
  );
  const memoryConfigValue = {
    memory_type: "megasaver_lm2_hybrid",
    memory_params: {
      manifest_path: manifestPath,
      manifest_digest: canonicalSha256(manifest),
      data_revision: DATA_REVISION,
      cache_parent: join(root, `${base}/cache`),
      transport_command: transportCommand,
      megasaver_commit: MEGA_COMMIT,
      profile: "adaptive",
      embedding_egress: "local",
      model: {
        provider: "local",
        modelId: "megasaver-hash-embedding",
        revision: "v1",
        dimensions: 64,
        embeddingInputVersion: "lm2-v1",
      },
      token_budget: 2_000,
      query_timeout_ms: 1_500,
      index_batch_timeout_ms: 15_000,
      rpc_timeout_seconds: 30,
    },
  };
  const memoryConfig = artifact(
    root,
    `${base}/runtime_inputs/memory_config.json`,
    memoryConfigValue,
  );
  const questions = artifact(root, `${base}/runtime_inputs/questions.json`, [runtimeQuestion]);
  const haystack = artifact(root, `${base}/runtime_inputs/haystack.json`, {
    [questionId]: [trajectory.id],
  });
  const trajectories = artifact(root, `${base}/runtime_inputs/trajectories.jsonl`, trajectory);
  const runArgsValue = {
    save_memory: false,
    skip_evaluation: false,
    load_memory_dir: null,
    base_url: null,
    api_key_env: "OPENAI_API_KEY",
    api_key_file: null,
    max_completion_tokens: 20_000,
    memory_context_max_tokens: 200_000,
    prompt_build_max_workers: 1,
    shuffle_questions_seed: null,
    reader_max_concurrent_requests: 500,
    timeout_seconds: 43_200,
    reasoning_effort: null,
    temperature: null,
    top_p: null,
    presence_penalty: null,
    top_k: null,
    repetition_penalty: null,
    reader_enable_thinking: true,
    evaluator_base_url: null,
    evaluator_api_key_env: "OPENAI_API_KEY",
    evaluator_api_key_file: null,
    evaluator_reasoning_effort: "medium",
    evaluator_max_completion_tokens: 4096,
    evaluator_timeout_seconds: 43_200,
    domain,
    questions_path: join(root, questions.path),
    haystack_path: join(root, haystack.path),
    trajectories_path: join(root, trajectories.path),
    memory_config_path: join(root, memoryConfig.path),
    output_dir: join(root, base),
    model: "Qwen/Qwen3.5-9B",
    evaluator_model: "gpt-5.2",
    started_at_utc: "2026-07-20T00:00:00+00:00",
  };
  const timing = {
    avg_seconds: 0.0125,
    p50_seconds: 0.0125,
    p95_seconds: 0.0125,
    max_seconds: 0.0125,
    total_seconds: 0.0125,
  };
  const metricsValue = {
    overall: { overall_full_set: 0.5, count_all_questions: 1 },
    non_abstention_by_category: { gotchas: { pct_correct: 0.5, count: 1 } },
    abstention_by_category: {},
    combined_abstention_by_category: {
      static: { pct_correct: 0.5, count: 1 },
      dynamic: { pct_correct: 0.5, count: 1 },
      procedure: { pct_correct: 0.5, count: 1 },
    },
    abstention_overall: {},
    memory_query: timing,
  };
  const telemetryValue = {
    profile: "adaptive",
    semanticStatus: "used",
    modelFingerprint: canonicalSha256(memoryConfigValue.memory_params.model),
    candidateCount: 1,
    selectionCount: 1,
    latencyMs: 10,
    questionId,
    questionType: "static-environment",
    imagePresent: false,
    imageUsed: false,
  };
  return {
    domain,
    tier: "small",
    command: "/usr/bin/python3",
    arguments: [
      "-m",
      "evaluation.harness",
      "--domain",
      domain,
      "--questions-path",
      join(root, questions.path),
      "--haystack-path",
      join(root, haystack.path),
      "--trajectories-path",
      join(root, trajectories.path),
      "--memory-config-path",
      join(root, memoryConfig.path),
      "--output-dir",
      join(root, base),
      "--model",
      "Qwen/Qwen3.5-9B",
      "--evaluator-model",
      "gpt-5.2",
    ],
    outputDirectory: base,
    runArgs: artifact(root, `${base}/run_args.json`, runArgsValue),
    aggregatedMetrics: artifact(root, `${base}/aggregated_metrics.json`, metricsValue),
    perQuestion: {
      ...artifact(root, `${base}/per_question.jsonl`, {
        question_id: questionId,
        question_type: "static-environment",
        category: "static",
        eval_function: "private",
        question_text: "What is the billing status?",
        question_image: null,
        answer_gold: "paid",
        memory_context: [{ type: "text", value: `${domain} billing status is paid` }],
        memory_query_duration_seconds: 0.0125,
        memory_post_query_metadata: telemetryValue,
        score: 0.5,
      }),
      rowCount: 1,
    },
    runtimeInputs: { questions, haystack, trajectories, memoryConfig, manifest: manifestArtifact },
    telemetry: {
      ...artifact(root, `${base}/telemetry/queries.jsonl`, telemetryValue),
      rowCount: 1,
    },
    rawLatencySamplesSeconds: [0.0125],
    failures: [],
  };
}

function packageRunArtifacts(
  root: string,
  packageDirectory: string,
  runs: ReadonlyArray<ReturnType<typeof runArtifacts>>,
) {
  for (const run of runs) {
    for (const entry of [
      run.runArgs,
      run.aggregatedMetrics,
      run.perQuestion,
      run.runtimeInputs.questions,
      run.runtimeInputs.haystack,
      run.runtimeInputs.trajectories,
      run.runtimeInputs.memoryConfig,
      run.runtimeInputs.manifest,
    ]) {
      const suffix = entry.path.slice(`runs/${run.domain}/`.length);
      const target = join(root, packageDirectory, "operating_points/balanced", run.domain, suffix);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, entry.path), target);
    }
  }
}

export function createEvidenceFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-evidence-")));
  roots.push(root);
  const executable = artifact(root, "inputs/node", "node executable\n");
  const transport = artifact(root, "inputs/lm2-benchmark.js", "transport\n");
  const adapter = artifact(root, "inputs/megasaver_lm2_hybrid.py", "class Backend: pass\n");
  const systemDescription = artifact(root, "inputs/SYSTEM_DESCRIPTION.md", "Mega Saver LM2\n");
  const transportCommand = [join(root, executable.path), join(root, transport.path)];
  const runs = [
    runArtifacts(root, "web", transportCommand),
    runArtifacts(root, "enterprise", transportCommand),
  ];
  const timing = {
    avg_seconds: 0.0125,
    max_seconds: 0.0125,
    total_seconds: 0.025,
  };
  const combinedValue = {
    overall: { overall_full_set: 0.5, count_all_questions: 2 },
    non_abstention_by_category: { gotchas: { pct_correct: 0.5, count: 2 } },
    combined_abstention_by_category: {
      static: { pct_correct: 0.5, count: 2 },
      dynamic: { pct_correct: 0.5, count: 2 },
      procedure: { pct_correct: 0.5, count: 2 },
    },
    memory_query: timing,
  };
  const combinedMetrics = artifact(root, "combined_metrics.json", combinedValue);
  const packageDirectory = "leaderboard/megasaver_lm2";
  packageRunArtifacts(root, packageDirectory, runs);
  artifact(root, `${packageDirectory}/SYSTEM_DESCRIPTION.md`, "Mega Saver LM2\n");
  artifact(root, `${packageDirectory}/megasaver_lm2_hybrid.py`, "class Backend: pass\n");
  const lafs = {
    tier: "small",
    t_min_seconds: 1,
    t_max_seconds: 200,
    floor_accuracy: 0,
    accuracy_unit: "percentage_points",
    reference_lafs: 1,
    submission_lafs: 1,
    lafs_gain: 0,
    reference_frontier: [],
    submission_frontier: [],
  };
  artifact(root, `${packageDirectory}/submission_overview.json`, {
    submission_name: "megasaver_lm2",
    method: "megasaver_lm2_hybrid",
    tier: "small",
    generated_at_utc: "2026-07-20T00:00:00+00:00",
    archive_name: "megasaver_lm2.tar.gz",
    system_description_file: "SYSTEM_DESCRIPTION.md",
    code_file: "megasaver_lm2_hybrid.py",
    lafs,
    operating_points: [
      {
        name: "balanced",
        overall_full_set: 0.5,
        memory_query_avg_seconds: 0.0125,
        lafs_accuracy_percentage_points: 50,
        lafs_latency_seconds: 0.0125,
      },
    ],
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
    generated_at_utc: "2026-07-20T00:00:00+00:00",
  });
  const packageFiles = execFileSync("find", [join(root, packageDirectory), "-type", "f"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((path) => ({ path: path.slice(root.length + 1), sha256: sha256(readFileSync(path)) }));
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
        revision: DATA_REVISION,
        preparationMode: "symlink",
        checksums,
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
        "memory_modules/memory.py":
          "512d48d93ff78208127c85ffd90ea4c63f1f9ccea3427f0a7b6928a39bdc6a59",
        "evaluation/harness.py": "4a508fde65e382c45669fe7243348944628054c9ce6416d78c0a395ce1c3abcd",
        "leaderboard/build_submission_step_1_single_operating_point.py":
          "8c197c28231a14b303ec8a11a5cd5ddbbe70a5e9072f1f97c28f30f484d8f078",
        "leaderboard/build_submission_step_2_build_package.py":
          "ae727018666e7131d6f1415515405f51ab91365ac9929ad0990d083a8bcf4907",
      },
      postInstallDirtyPaths: ["memory_modules/megasaver_lm2_hybrid.py", "memory_modules/memory.py"],
      postInstallHashes: {
        "memory_modules/megasaver_lm2_hybrid.py": adapter.sha256,
        "memory_modules/memory.py": "c".repeat(64),
      },
      postInstallDiffs: [
        { path: "memory_modules/megasaver_lm2_hybrid.py", sha256: adapter.sha256 },
        { path: "memory_modules/memory.py", sha256: "d".repeat(64) },
      ],
    },
    configuration: {
      reader: { provider: "local-openai-compatible", model: "Qwen/Qwen3.5-9B", parameters: {} },
      judge: {
        provider: "openai",
        model: "gpt-5.2",
        parameters: {
          baseUrl: null,
          apiKeyEnv: "OPENAI_API_KEY",
          apiKeyFile: null,
          reasoningEffort: "medium",
          maxCompletionTokens: 4096,
          timeoutSeconds: 43_200,
        },
      },
      embedding: {
        provider: "local",
        model: "megasaver-hash-embedding",
        egress: "local",
        parameters: { revision: "v1", dimensions: 64, embeddingInputVersion: "lm2-v1" },
      },
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
      megaSaverCommit: MEGA_COMMIT,
      adapter,
      transport,
      transportExecutable: { path: join(root, executable.path), sha256: executable.sha256 },
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
      codeArtifact: adapter,
      packageDirectory,
      packageFiles,
      submissionOverview: packageFiles.find((entry) =>
        entry.path.endsWith("submission_overview.json"),
      ),
      tarball: {
        path: "leaderboard/megasaver_lm2.tar.gz",
        sha256: sha256(readFileSync(join(root, "leaderboard/megasaver_lm2.tar.gz"))),
      },
      step1: {
        exitCode: 0,
        arguments: [
          "runs/web",
          "runs/enterprise",
          "megasaver_lm2",
          "balanced",
          "small",
          "--method",
          "megasaver_lm2_hybrid",
          "--output-root",
          "leaderboard",
        ],
      },
      step2: {
        exitCode: 0,
        arguments: [
          "megasaver_lm2",
          "inputs/SYSTEM_DESCRIPTION.md",
          "inputs/megasaver_lm2_hybrid.py",
          "leaderboard/megasaver_lm2/operating_points/balanced",
          "--output-root",
          "leaderboard",
        ],
      },
    },
  };
  const evidencePath = join(root, "evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
  return { evidence, evidencePath, root };
}

export function writeEvidence(fixture: ReturnType<typeof createEvidenceFixture>): void {
  writeFileSync(fixture.evidencePath, `${JSON.stringify(fixture.evidence)}\n`);
}

export function cleanupEvidenceRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
