import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
});
