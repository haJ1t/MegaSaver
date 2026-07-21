import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifact,
  cleanupEvidenceRoots,
  createEvidenceFixture,
  schemaPath,
  sha256,
  verifier,
  writeEvidence,
} from "./lm2-completion-fixtures.js";

afterEach(cleanupEvidenceRoots);

type MutationContext = {
  root: string;
  value: ReturnType<typeof createEvidenceFixture>["evidence"];
};

function mutateTelemetryAndOfficialMetadata(
  evidence: MutationContext,
  mutate: (row: Record<string, unknown>) => void,
) {
  const run = evidence.value.runs[0];
  const telemetry = JSON.parse(readFileSync(join(evidence.root, run.telemetry.path), "utf8"));
  const perQuestion = JSON.parse(readFileSync(join(evidence.root, run.perQuestion.path), "utf8"));
  mutate(telemetry);
  perQuestion.memory_post_query_metadata = telemetry;
  Object.assign(run.telemetry, artifact(evidence.root, run.telemetry.path, telemetry));
  Object.assign(run.perQuestion, artifact(evidence.root, run.perQuestion.path, perQuestion));
}

function mutatePerQuestion(
  evidence: MutationContext,
  mutate: (row: Record<string, unknown>) => void,
) {
  const run = evidence.value.runs[0];
  const row = JSON.parse(readFileSync(join(evidence.root, run.perQuestion.path), "utf8"));
  mutate(row);
  Object.assign(run.perQuestion, artifact(evidence.root, run.perQuestion.path, row));
}

function replaceRunArgsInteger(evidence: MutationContext, key: string, exactInteger: string) {
  const ref = evidence.value.runs[0].runArgs;
  const bytes = readFileSync(join(evidence.root, ref.path), "utf8");
  const pattern = new RegExp(`("${key}":)-?[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?`, "iu");
  const replaced = bytes.replace(pattern, `$1${exactInteger}`);
  expect(replaced).not.toBe(bytes);
  Object.assign(ref, artifact(evidence.root, ref.path, replaced));
}

describe("LM2 official-score evidence gate", () => {
  it("inspects every required evidence class without authorizing a score", () => {
    const fixture = createEvidenceFixture();
    const result = execFileSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );

    expect(JSON.parse(result)).toMatchObject({ valid: true, officialScoreEligible: false });
    expect(JSON.parse(readFileSync(schemaPath, "utf8")).$id).toBe(
      "https://megasaver.dev/schemas/lm2-official-evidence-v1.json",
    );
  });

  it("accepts the pinned official combined timing shape without local percentiles", () => {
    const pinned = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures/lm2-pinned-combine-timing.json"), "utf8"),
    );
    const fixture = createEvidenceFixture();
    const combined = JSON.parse(
      readFileSync(join(fixture.root, fixture.evidence.combined.metrics.path), "utf8"),
    );

    expect(combined.memory_query).toEqual({
      avg_seconds: 0.0125,
      max_seconds: 0.0125,
      total_seconds: 0.025,
    });
    expect(pinned.expected).toEqual({ avg_seconds: 0.02, max_seconds: 0.04, total_seconds: 0.08 });
    expect(() =>
      execFileSync(process.execPath, [verifier, "--inspect", "--evidence", fixture.evidencePath]),
    ).not.toThrow();
  });

  it("combines domain timing totals in pinned official floating-point order", async () => {
    const pinned = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures/lm2-pinned-combine-timing.json"), "utf8"),
    );
    const module = (await import(
      pathToFileURL(
        join(
          import.meta.dirname,
          "../../../benchmarks/longmemeval-v2/official-evidence-run-bindings.mjs",
        ),
      ).href
    )) as {
      officialCombinedTiming: (
        domains: Array<{ count: number; summary: Record<string, number> }>,
      ) => Record<string, number>;
    };
    const floating = pinned.floatingOrder;

    expect(
      module.officialCombinedTiming([
        { count: floating.left.count, summary: floating.left.summary },
        { count: floating.right.count, summary: floating.right.summary },
      ]),
    ).toEqual(floating.expected);
  });

  it("uses canonical Python integer lexemes for pinned type=int harness flags", () => {
    const pinned = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures/lm2-pinned-integer-arguments.json"), "utf8"),
    );
    for (const valueCase of pinned.cases) {
      const fixture = createEvidenceFixture();
      const run = fixture.evidence.runs[0];
      run.arguments.push(pinned.flag, valueCase.value);
      replaceRunArgsInteger(
        { root: fixture.root, value: fixture.evidence },
        "max_completion_tokens",
        /^[+-]?[0-9]+$/u.test(valueCase.value.trim())
          ? BigInt(valueCase.value.trim()).toString()
          : String(Number(valueCase.value)),
      );
      writeEvidence(fixture);

      const result = spawnSync(
        process.execPath,
        [verifier, "--inspect", "--evidence", fixture.evidencePath],
        { encoding: "utf8" },
      );
      expect(result.status, valueCase.value).toBe(valueCase.evidenceAccepts ? 0 : 1);
    }
  });

  it("compares large official integers without numeric precision loss", () => {
    const fixture = createEvidenceFixture();
    const run = fixture.evidence.runs[0];
    run.arguments.push("--max-completion-tokens", "900719925474099312345678901234567890");
    replaceRunArgsInteger(
      { root: fixture.root, value: fixture.evidence },
      "max_completion_tokens",
      "900719925474099312345678901234567891",
    );
    writeEvidence(fixture);

    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run_args.json differs");
  });

  it("rejects local percentiles added to the official combined timing", () => {
    const fixture = createEvidenceFixture();
    const ref = fixture.evidence.combined.metrics;
    const combined = JSON.parse(readFileSync(join(fixture.root, ref.path), "utf8"));
    combined.memory_query.p50_seconds = 0.0125;
    Object.assign(ref, artifact(fixture.root, ref.path, combined));
    writeEvidence(fixture);

    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
  });

  it.each([
    "official.data.validator",
    "installation.postInstallDiffs",
    "configuration.embedding",
    "hardware.cpuModel",
    "implementation.transport",
    "implementation.transportExecutable",
    "runs.0.telemetry",
    "runs.0.runtimeInputs.memoryConfig",
    "runs.0.runtimeInputs.manifest",
    "runs.0.runtimeInputs.trajectories",
    "runs.0.rawLatencySamplesSeconds",
    "runs.0.failures",
    "combined.dashboard.procedureAccuracy",
    "leaderboard.tarball",
  ])("fails closed when %s is missing", (field) => {
    const fixture = createEvidenceFixture();
    let target: Record<string, unknown> | unknown[] = fixture.evidence as never;
    const parts = field.split(".");
    for (const part of parts.slice(0, -1)) {
      target = target[Number.isNaN(Number(part)) ? part : Number(part)] as never;
    }
    delete target[parts.at(-1) as never];
    writeEvidence(fixture);

    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Evidence gate failed");
  });

  it("never reports eligibility when full official revalidation cannot run", () => {
    const fixture = createEvidenceFixture();
    const result = spawnSync(
      process.execPath,
      [
        verifier,
        "--evidence",
        fixture.evidencePath,
        "--official-root",
        join(fixture.root, "missing"),
        "--data-root",
        join(fixture.root, "missing-data"),
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('officialScoreEligible":true');
  });

  it.each([
    [
      "executes the JSON schema",
      (evidence: MutationContext) => {
        evidence.value.hardware.accelerators[0].name = "";
      },
    ],
    [
      "rejects unsafe official builder names",
      (evidence: MutationContext) => {
        evidence.value.leaderboard.submissionName = ".";
      },
    ],
    [
      "binds telemetry to official question ids",
      (evidence: MutationContext) => {
        const row = JSON.parse(
          readFileSync(join(evidence.root, evidence.value.runs[0].telemetry.path), "utf8"),
        );
        row.questionId = "substituted-question";
        Object.assign(
          evidence.value.runs[0].telemetry,
          artifact(evidence.root, evidence.value.runs[0].telemetry.path, row),
        );
      },
    ],
    [
      "rejects a nonofficial harness module",
      (evidence: MutationContext) => {
        evidence.value.runs[0].arguments[1] = "custom.runner";
      },
    ],
    [
      "rejects an extra nonofficial harness argument",
      (evidence: MutationContext) => {
        evidence.value.runs[0].arguments.push("--custom-runner-flag", "enabled");
      },
    ],
    [
      "rejects a value outside pinned harness choices",
      (evidence: MutationContext) => {
        const run = evidence.value.runs[0];
        run.arguments.push("--reasoning-effort", "ultra");
        const runArgs = JSON.parse(readFileSync(join(evidence.root, run.runArgs.path), "utf8"));
        runArgs.reasoning_effort = "ultra";
        Object.assign(run.runArgs, artifact(evidence.root, run.runArgs.path, runArgs));
      },
    ],
    [
      "maps telemetry latency exactly through official per-question metadata",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].telemetry;
        const row = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        row.latencyMs = 13;
        Object.assign(ref, artifact(evidence.root, ref.path, row));
      },
    ],
    [
      "rejects an invalid latency even when both telemetry sources agree",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.latencyMs = -1;
        });
      },
    ],
    [
      "rejects inflated telemetry latency even when both telemetry copies agree",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.latencyMs = 13;
        });
      },
    ],
    [
      "binds the exact transport command",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].runtimeInputs.memoryConfig;
        const config = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        config.memory_params.transport_command = [
          evidence.value.implementation.transportExecutable.path,
        ];
        Object.assign(ref, artifact(evidence.root, ref.path, config));
      },
    ],
    [
      "binds run_args to the recorded questions path",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].runArgs;
        const runArgs = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        runArgs.questions_path = join(
          evidence.root,
          evidence.value.runs[1].runtimeInputs.questions.path,
        );
        Object.assign(ref, artifact(evidence.root, ref.path, runArgs));
      },
    ],
    [
      "rejects an altered official answer",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].runtimeInputs.questions;
        const questions = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        questions[0].answer = "altered-answer";
        Object.assign(ref, artifact(evidence.root, ref.path, questions));
      },
    ],
    [
      "binds the official evaluator specification per question",
      (evidence: MutationContext) => {
        mutatePerQuestion(evidence, (row) => {
          row.eval_function = "substituted-evaluator";
        });
      },
    ],
    [
      "binds the official aggregate category per question",
      (evidence: MutationContext) => {
        mutatePerQuestion(evidence, (row) => {
          row.category = "gotchas";
        });
      },
    ],
    [
      "binds the official question text per question",
      (evidence: MutationContext) => {
        mutatePerQuestion(evidence, (row) => {
          row.question_text = "Substituted question";
        });
      },
    ],
    [
      "rejects an altered runtime haystack",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].runtimeInputs.haystack;
        const haystack = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        haystack["web-question"] = [];
        Object.assign(ref, artifact(evidence.root, ref.path, haystack));
      },
    ],
    [
      "rejects an altered runtime trajectory",
      (evidence: MutationContext) => {
        const ref = evidence.value.runs[0].runtimeInputs.trajectories;
        const trajectory = JSON.parse(readFileSync(join(evidence.root, ref.path), "utf8"));
        trajectory.states[0].accessibility_tree = "altered input";
        Object.assign(ref, artifact(evidence.root, ref.path, trajectory));
      },
    ],
    [
      "correlates telemetry profile and metadata exactly",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.profile = "safe";
        });
      },
    ],
    [
      "correlates telemetry status with the public contract",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.semanticStatus = "invented-status";
        });
      },
    ],
    [
      "correlates telemetry counts with manifest candidates",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.candidateCount = 999;
        });
      },
    ],
    [
      "correlates telemetry model fingerprint with memory config",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.modelFingerprint = "f".repeat(64);
        });
      },
    ],
    [
      "correlates telemetry question type with official input",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.questionType = "dynamic";
        });
      },
    ],
    [
      "correlates telemetry image state with official input",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.imagePresent = true;
        });
      },
    ],
    [
      "binds the executed evaluator model",
      (evidence: MutationContext) => {
        const run = evidence.value.runs[0];
        const index = run.arguments.indexOf("--evaluator-model");
        run.arguments[index + 1] = "altered-evaluator";
      },
    ],
    [
      "binds the official judge model",
      (evidence: MutationContext) => {
        evidence.value.configuration.judge.model = "substituted-evaluator";
      },
    ],
    ...[
      ["baseUrl", "https://substituted.example"],
      ["apiKeyEnv", "SUBSTITUTED_API_KEY"],
      ["apiKeyFile", "/tmp/substituted-key"],
      ["reasoningEffort", "high"],
      ["maxCompletionTokens", 8192],
      ["timeoutSeconds", 1],
    ].map(([field, value]) => [
      `binds the official judge ${field} parameter`,
      (evidence: MutationContext) => {
        (evidence.value.configuration.judge.parameters as Record<string, unknown>)[
          field as string
        ] = value;
      },
    ]),
    [
      "rejects raw question content smuggled through telemetry",
      (evidence: MutationContext) => {
        mutateTelemetryAndOfficialMetadata(evidence, (row) => {
          row.rejectionReason = "What is the billing status?";
        });
      },
    ],
  ])("%s", (_label, mutate) => {
    const fixture = createEvidenceFixture();
    mutate({ root: fixture.root, value: fixture.evidence });
    writeEvidence(fixture);
    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('officialScoreEligible":true');
  });

  it("rejects a recorded tar with authentic names but altered archived bytes", () => {
    const fixture = createEvidenceFixture();
    const forgedRoot = join(fixture.root, "forged");
    const forgedPackage = join(forgedRoot, "megasaver_lm2");
    mkdirSync(forgedRoot);
    cpSync(join(fixture.root, fixture.evidence.leaderboard.packageDirectory), forgedPackage, {
      recursive: true,
    });
    writeFileSync(join(forgedPackage, "SYSTEM_DESCRIPTION.md"), "forged bytes\n");
    const tarPath = join(fixture.root, fixture.evidence.leaderboard.tarball.path);
    execFileSync("tar", ["-czf", tarPath, "megasaver_lm2"], { cwd: forgedRoot });
    fixture.evidence.leaderboard.tarball.sha256 = sha256(readFileSync(tarPath));
    writeEvidence(fixture);

    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
  });

  it("rejects unsafe directory members before discarding tar directories", () => {
    const fixture = createEvidenceFixture();
    const tarPath = join(fixture.root, fixture.evidence.leaderboard.tarball.path);
    const packageRoot = join(fixture.root, fixture.evidence.leaderboard.packageDirectory);
    const code = [
      "import io,sys,tarfile",
      "archive,package=sys.argv[1:]",
      "with tarfile.open(archive,'w:gz') as tf:",
      " tf.add(package,arcname='megasaver_lm2')",
      " unsafe=tarfile.TarInfo('megasaver_lm2/../escape/')",
      " unsafe.type=tarfile.DIRTYPE",
      " tf.addfile(unsafe)",
    ].join("\n");
    execFileSync("python3", ["-c", code, tarPath, packageRoot]);
    fixture.evidence.leaderboard.tarball.sha256 = sha256(readFileSync(tarPath));
    writeEvidence(fixture);

    const result = spawnSync(
      process.execPath,
      [verifier, "--inspect", "--evidence", fixture.evidencePath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
  });

  it("rejects a fresh official tar digest mismatch even when package bytes match", async () => {
    const module = (await import(
      pathToFileURL(
        join(
          import.meta.dirname,
          "../../../benchmarks/longmemeval-v2/official-evidence-freshness.mjs",
        ),
      ).href
    )) as {
      verifyFreshTarballDigest?: (fresh: string, recorded: string) => void;
    };

    expect(() => module.verifyFreshTarballDigest?.("a".repeat(64), "b".repeat(64))).toThrow(
      "Fresh official tar digest differs",
    );
  });
});
