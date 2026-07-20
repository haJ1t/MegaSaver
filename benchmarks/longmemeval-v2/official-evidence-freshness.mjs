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
  if (
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: options.repoRoot,
      encoding: "utf8",
    }).trim() !== options.inspected.evidence.implementation.megaSaverCommit
  )
    fail("Mega Saver commit binding differs.");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-fresh-")));
  try {
    verifyManifestBuilds(temp, options);
    return verifyBuilders(temp, options);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
