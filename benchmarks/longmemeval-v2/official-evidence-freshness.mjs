import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}
export function verifyFreshTarballDigest(fresh, recorded) {
  if (fresh !== recorded) fail("Fresh official tar digest differs from recorded evidence.");
}
function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function files(root, current = root) {
  return readdirSync(current)
    .flatMap((name) => {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail(`Fresh artifact contains a symlink: ${path}`);
      if (stat.isDirectory()) return files(root, path);
      if (!stat.isFile()) fail(`Fresh artifact is not a regular file: ${path}`);
      return relative(root, path);
    })
    .sort();
}
function exactTree(left, right, label) {
  const leftFiles = files(left);
  const rightFiles = files(right);
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) fail(`${label} inventory differs.`);
  for (const name of leftFiles)
    if (!readFileSync(join(left, name)).equals(readFileSync(join(right, name))))
      fail(`${label} bytes differ: ${name}`);
  return leftFiles;
}
function sameBytes(left, right) {
  return readFileSync(left).equals(readFileSync(right));
}
function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function verifyMegaSaverProvenance(input) {
  if (git(input.repoRoot, ["rev-parse", "HEAD"]) !== input.commit) {
    fail("Mega Saver commit binding differs.");
  }
  if (git(input.repoRoot, ["status", "--porcelain"]) !== "") {
    fail("Mega Saver checkout must be clean at the recorded commit.");
  }
  const adapter = join(input.repoRoot, "benchmarks/longmemeval-v2/megasaver_lm2_hybrid.py");
  const transport = join(input.repoRoot, "packages/long-memory/dist/lm2-benchmark.js");
  if (!sameBytes(adapter, input.recordedAdapter)) fail("Recorded adapter differs from the commit.");
  if (!sameBytes(transport, input.recordedTransport))
    fail("Recorded transport differs from the commit.");
  if (input.rebuild !== false) {
    execFileSync("pnpm", ["--filter", "@megasaver/long-memory", "build"], {
      cwd: input.repoRoot,
      stdio: "pipe",
    });
    if (git(input.repoRoot, ["status", "--porcelain"]) !== "") {
      fail("Mega Saver build changed the recorded clean checkout.");
    }
    if (!sameBytes(adapter, input.recordedAdapter)) fail("Fresh adapter bytes differ.");
    if (!sameBytes(transport, input.recordedTransport)) fail("Fresh transport bytes differ.");
  }
}
function runTimestampedBuilder(python, officialRoot, moduleName, timestamp, args) {
  const code = `import sys; import ${moduleName} as m; m.utc_now_iso=lambda:sys.argv[1]; sys.argv=[m.__file__,*sys.argv[2:]]; m.main()`;
  execFileSync(python, ["-c", code, timestamp, ...args], { cwd: officialRoot, stdio: "pipe" });
}
function verifyManifestBuilds(temp, options) {
  for (const run of options.inspected.runs) {
    const output = join(temp, `manifest-${run.domain}.json`);
    const built = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(options.repoRoot, "benchmarks/longmemeval-v2/build-lm2-manifest.mjs"),
          "--official-root",
          options.officialRoot,
          "--data-root",
          options.dataRoot,
          "--domain",
          run.domain,
          "--tier",
          run.tier,
          "--output",
          output,
        ],
        {
          cwd: options.repoRoot,
          env: { ...process.env, PYTHON: options.python },
          encoding: "utf8",
        },
      ),
    );
    const recorded = resolve(options.inspected.root, run.runtimeInputs.manifest.path);
    if (!readFileSync(output).equals(readFileSync(recorded)))
      fail(`Rebuilt official manifest bytes differ: ${run.domain}`);
    const config = JSON.parse(
      readFileSync(resolve(options.inspected.root, run.runtimeInputs.memoryConfig.path), "utf8"),
    );
    if (
      built.manifestPath !== output ||
      config.memory_params.manifest_digest !== built.manifestDigest
    )
      fail(`Rebuilt official manifest digest differs: ${run.domain}`);
  }
}
function verifyReleasedRunInputs(temp, options) {
  const trajectories = join(options.dataRoot, "trajectories.jsonl");
  const code = [
    "import json,sys",
    "from pathlib import Path",
    "from data.public_data import materialize_runtime_questions,materialize_runtime_haystack",
    "root=Path(sys.argv[1]);domain=sys.argv[2];tier=sys.argv[3]",
    "questions=materialize_runtime_questions(data_root=root,domain=domain,question_ids=None,limit=None,output_path=Path(sys.argv[4]))",
    "materialize_runtime_haystack(data_root=root,tier=tier,selected_questions=questions,output_path=Path(sys.argv[5]))",
  ].join(";");
  for (const run of options.inspected.runs) {
    const questionsPath = resolve(options.inspected.root, run.runtimeInputs.questions.path);
    const haystackPath = resolve(options.inspected.root, run.runtimeInputs.haystack.path);
    const trajectoryPath = resolve(options.inspected.root, run.runtimeInputs.trajectories.path);
    const freshQuestions = join(temp, `${run.domain}-questions.json`);
    const freshHaystack = join(temp, `${run.domain}-haystack.json`);
    execFileSync(
      options.python,
      ["-c", code, options.dataRoot, run.domain, run.tier, freshQuestions, freshHaystack],
      { cwd: options.officialRoot, stdio: "pipe" },
    );
    if (!sameBytes(freshQuestions, questionsPath) || !sameBytes(freshHaystack, haystackPath)) {
      fail(`Recorded runtime inputs differ from released official data: ${run.domain}`);
    }
    if (!sameBytes(trajectories, trajectoryPath)) {
      fail(`Recorded trajectories differ from released official bytes: ${run.domain}`);
    }
  }
}
function verifyBuilders(temp, options) {
  const { inspected, officialRoot, python } = options;
  const outputRoot = join(temp, "leaderboard");
  const runByDomain = Object.fromEntries(inspected.runs.map((run) => [run.domain, run]));
  const expectedStep1 = [
    runByDomain.web.outputDirectory,
    runByDomain.enterprise.outputDirectory,
    inspected.leaderboard.submissionName,
    inspected.leaderboard.operatingPointName,
    inspected.tier,
    "--method",
    "megasaver_lm2_hybrid",
    "--output-root",
    "leaderboard",
  ];
  const expectedStep2 = [
    inspected.leaderboard.submissionName,
    inspected.leaderboard.systemDescription.path,
    inspected.leaderboard.codeArtifact.path,
    `${inspected.leaderboard.packageDirectory}/operating_points/${inspected.leaderboard.operatingPointName}`,
    "--output-root",
    "leaderboard",
  ];
  if (
    JSON.stringify(inspected.leaderboard.step1.arguments) !== JSON.stringify(expectedStep1) ||
    JSON.stringify(inspected.leaderboard.step2.arguments) !== JSON.stringify(expectedStep2)
  )
    fail("Recorded official builder invocation differs.");
  const byDomain = Object.fromEntries(
    inspected.runs.map((run) => [run.domain, resolve(inspected.root, run.outputDirectory)]),
  );
  const recordedPackage = resolve(inspected.root, inspected.leaderboard.packageDirectory);
  const point = join(
    outputRoot,
    inspected.leaderboard.submissionName,
    "operating_points",
    inspected.leaderboard.operatingPointName,
  );
  const pointTimestamp = JSON.parse(
    readFileSync(
      join(
        recordedPackage,
        "operating_points",
        inspected.leaderboard.operatingPointName,
        "operating_point_metadata.json",
      ),
      "utf8",
    ),
  ).generated_at_utc;
  runTimestampedBuilder(
    python,
    officialRoot,
    "leaderboard.build_submission_step_1_single_operating_point",
    pointTimestamp,
    [
      byDomain.web,
      byDomain.enterprise,
      inspected.leaderboard.submissionName,
      inspected.leaderboard.operatingPointName,
      inspected.tier,
      "--method",
      "megasaver_lm2_hybrid",
      "--output-root",
      outputRoot,
    ],
  );
  const overviewTimestamp = JSON.parse(
    readFileSync(join(recordedPackage, "submission_overview.json"), "utf8"),
  ).generated_at_utc;
  runTimestampedBuilder(
    python,
    officialRoot,
    "leaderboard.build_submission_step_2_build_package",
    overviewTimestamp,
    [
      inspected.leaderboard.submissionName,
      resolve(inspected.root, inspected.leaderboard.systemDescription.path),
      resolve(inspected.root, inspected.leaderboard.codeArtifact.path),
      point,
      "--output-root",
      outputRoot,
    ],
  );
  const freshPackage = join(outputRoot, inspected.leaderboard.submissionName);
  const packageFiles = exactTree(freshPackage, recordedPackage, "Fresh official package");
  const archive = join(outputRoot, `${inspected.leaderboard.submissionName}.tar.gz`);
  const extractRoot = join(temp, "fresh-tar");
  mkdirSync(extractRoot);
  execFileSync("tar", ["-xzf", archive, "-C", extractRoot]);
  exactTree(join(extractRoot, basename(freshPackage)), freshPackage, "Fresh official tar contents");
  return {
    packageFileCount: packageFiles.length,
    tarballSha256: digest(archive),
    submissionOverviewSha256: digest(join(freshPackage, "submission_overview.json")),
  };
}

export function verifyFreshOfficialArtifacts(options) {
  verifyMegaSaverProvenance({
    repoRoot: options.repoRoot,
    commit: options.inspected.evidence.implementation.megaSaverCommit,
    recordedAdapter: resolve(
      options.inspected.root,
      options.inspected.evidence.implementation.adapter.path,
    ),
    recordedTransport: resolve(
      options.inspected.root,
      options.inspected.evidence.implementation.transport.path,
    ),
  });
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-fresh-")));
  try {
    verifyReleasedRunInputs(temp, options);
    verifyManifestBuilds(temp, options);
    const artifacts = verifyBuilders(temp, options);
    verifyFreshTarballDigest(artifacts.tarballSha256, options.inspected.leaderboard.tarball.sha256);
    return artifacts;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
