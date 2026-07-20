import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const benchmarkRoot = join(import.meta.dirname, "../../../benchmarks/longmemeval-v2");

describe("LM2 pinned benchmark preparation tools", () => {
  it("publishes the exact official and data contract", () => {
    const output = execFileSync(
      process.execPath,
      [join(benchmarkRoot, "build-lm2-manifest.mjs"), "--contract"],
      { encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual({
      officialCommit: "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
      repoId: "xiaowu0162/longmemeval-v2",
      revision: "f152293e235517d504809563c833d7190b8c713b",
      checksums: {
        schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
        questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
        trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
        small: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
        medium: "4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59",
      },
    });
  });

  it("pins the official installer allowlist and baseline hashes", () => {
    const contract = JSON.parse(
      readFileSync(join(benchmarkRoot, "official-contract-6f020ac2.json"), "utf8"),
    );
    expect(contract).toEqual({
      officialCommit: "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
      files: {
        "memory_modules/memory.py":
          "512d48d93ff78208127c85ffd90ea4c63f1f9ccea3427f0a7b6928a39bdc6a59",
        "evaluation/harness.py": "4a508fde65e382c45669fe7243348944628054c9ce6416d78c0a395ce1c3abcd",
        "leaderboard/build_submission_step_1_single_operating_point.py":
          "8c197c28231a14b303ec8a11a5cd5ddbbe70a5e9072f1f97c28f30f484d8f078",
        "leaderboard/build_submission_step_2_build_package.py":
          "ae727018666e7131d6f1415515405f51ab91365ac9929ad0990d083a8bcf4907",
      },
      allowedDirtyPaths: ["memory_modules/megasaver_lm2_hybrid.py", "memory_modules/memory.py"],
    });
  });
});
