import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifact,
  cleanupEvidenceRoots,
  createEvidenceFixture,
  schemaPath,
  verifier,
  writeEvidence,
} from "./lm2-completion-fixtures.js";

afterEach(cleanupEvidenceRoots);

type MutationContext = {
  root: string;
  value: ReturnType<typeof createEvidenceFixture>["evidence"];
};

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
      "bounds internal latency by harness latency",
      (evidence: MutationContext) => {
        const row = JSON.parse(
          readFileSync(join(evidence.root, evidence.value.runs[0].telemetry.path), "utf8"),
        );
        row.latencyMs = 13;
        Object.assign(
          evidence.value.runs[0].telemetry,
          artifact(evidence.root, evidence.value.runs[0].telemetry.path, row),
        );
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
});
