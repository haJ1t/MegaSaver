#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
// biome-ignore format: The standalone gate is one responsibility and must stay below the repository's 300-line source limit.
{
const PIN = {
  commit: "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
  revision: "f152293e235517d504809563c833d7190b8c713b",
  repoId: "xiaowu0162/longmemeval-v2",
  checksums: {
    schema: "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
    questions: "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
    trajectories: "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
    small: "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
    medium: "4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59",
  },
  officialFiles: {
    "memory_modules/memory.py": "512d48d93ff78208127c85ffd90ea4c63f1f9ccea3427f0a7b6928a39bdc6a59",
    "evaluation/harness.py": "4a508fde65e382c45669fe7243348944628054c9ce6416d78c0a395ce1c3abcd",
    "leaderboard/build_submission_step_1_single_operating_point.py":
      "8c197c28231a14b303ec8a11a5cd5ddbbe70a5e9072f1f97c28f30f484d8f078",
    "leaderboard/build_submission_step_2_build_package.py":
      "ae727018666e7131d6f1415515405f51ab91365ac9929ad0990d083a8bcf4907",
  },
};
const IMPORT_LINE =
  "from .megasaver_lm2_hybrid import MegaSaverLm2HybridMemory  # MEGASAVER_LM2_BACKEND_IMPORT\n";
const DIRTY_PATHS = ["memory_modules/megasaver_lm2_hybrid.py", "memory_modules/memory.py"];
const TELEMETRY_KEYS = new Set([
  "profile",
  "semanticStatus",
  "rejectionReason",
  "observedAt",
  "auditId",
  "modelFingerprint",
  "candidateCount",
  "selectionCount",
  "latencyMs",
  "questionId",
  "questionType",
  "imagePresent",
  "imageUsed",
]);
const TELEMETRY_REQUIRED = ["profile", "semanticStatus", "modelFingerprint", "candidateCount", "selectionCount", "latencyMs", "imagePresent", "imageUsed"]; const FAILURE_KEYS = ["questionId", "stage", "code", "messageSha256"];
function fail(message) { throw new Error(message); }
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function exact(value, names, label) {
  const object = record(value, label);
  const actual = Object.keys(object).sort();
  const expected = [...names].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields differ.`);
  return object;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function fileSha256(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Artifact is not a regular file: ${path}`);
  return sha256(readFileSync(path));
}
function isDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
function resolveInside(root, name, directory = false) {
  if (typeof name !== "string" || !name || isAbsolute(name)) fail("Artifact path must be relative.");
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) fail("Artifact path escapes evidence root.");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail(`Unsafe artifact: ${name}`);
  if (realpathSync(path) !== path) fail(`Artifact path is not canonical: ${name}`);
  return path;
}
function verifyArtifact(root, value, counted = false) {
  const ref = exact(value, counted ? ["path", "sha256", "rowCount"] : ["path", "sha256"], "artifact");
  if (!isDigest(ref.sha256)) fail("Artifact digest is invalid.");
  const path = resolveInside(root, ref.path);
  if (fileSha256(path) !== ref.sha256) fail(`Artifact digest mismatch: ${ref.path}`);
  if (counted && (!Number.isInteger(ref.rowCount) || ref.rowCount < 1)) fail("Artifact rowCount is invalid.");
  return path;
}
function json(path) { return JSON.parse(readFileSync(path, "utf8")); }
function jsonl(path) { return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)); }
function numeric(value, label, maximum = Number.POSITIVE_INFINITY) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) fail(`${label} is invalid.`); }
function modelConfig(value, label, embedding = false) {
  const config = exact(value, embedding ? ["provider", "model", "egress", "parameters"] : ["provider", "model", "parameters"], label);
  if (typeof config.provider !== "string" || !config.provider || typeof config.model !== "string" || !config.model) fail(`${label} is incomplete.`);
  record(config.parameters, `${label}.parameters`);
  if (embedding && config.egress !== "local") fail("Official embedding egress must be local.");
  if (/"(?:api.?key|secret|password|credential|authorization)"\s*:/iu.test(JSON.stringify(config))) fail(`${label} contains a secret field.`);
}
function metric(metrics, path) {
  let value = metrics;
  for (const key of path) value = record(value, path.join("."))[key];
  numeric(value, path.join("."), 1);
  return value;
}
function walkFiles(root, current = root) {
  const files = [];
  for (const name of readdirSync(current)) {
    const path = join(current, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail(`Package contains a symlink: ${path}`);
    if (stat.isDirectory()) files.push(...walkFiles(root, path));
    else if (stat.isFile()) files.push(relative(root, path));
    else fail(`Package contains an unsupported entry: ${path}`);
  }
  return files.sort();
}
function verifyTar(packageRoot, archive, files) {
  const members = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter((name) => name && !name.endsWith("/")).sort();
  const expected = files.map((path) => `${basename(packageRoot)}/${path}`).sort();
  if (JSON.stringify(members) !== JSON.stringify(expected)) fail("Tarball contents differ from the package inventory.");
}
function verifyPackage(root, leaderboard, tier, dashboard) {
  const packageRoot = resolveInside(root, leaderboard.packageDirectory, true);
  if (!Array.isArray(leaderboard.packageFiles) || leaderboard.packageFiles.length < 15) fail("Package inventory is incomplete.");
  const refs = leaderboard.packageFiles.map((entry) => {
    verifyArtifact(root, entry);
    return entry.path;
  });
  const packageFiles = walkFiles(packageRoot); const expected = packageFiles.map((path) => join(leaderboard.packageDirectory, path)).sort();
  if (JSON.stringify([...refs].sort()) !== JSON.stringify(expected)) fail("Package inventory differs from disk.");
  const op = `operating_points/${leaderboard.operatingPointName}`;
  const required = [
    "SYSTEM_DESCRIPTION.md",
    basename(leaderboard.codeArtifact.path),
    "submission_overview.json",
    `${op}/metric_overview.json`,
    `${op}/operating_point_metadata.json`,
    ...["web", "enterprise"].flatMap((domain) =>
      ["aggregated_metrics.json", "per_question.jsonl", "run_args.json", "runtime_inputs/questions.json", "runtime_inputs/haystack.json", "runtime_inputs/memory_config.json"].map((name) => `${op}/${domain}/${name}`),
    ),
  ];
  if (required.some((name) => !expected.includes(join(leaderboard.packageDirectory, name)))) fail("Package required files are incomplete.");
  const overviewPath = verifyArtifact(root, leaderboard.submissionOverview);
  if (overviewPath !== join(packageRoot, "submission_overview.json")) fail("Submission overview reference differs.");
  const overview = record(json(overviewPath), "submission overview");
  if (overview.submission_name !== leaderboard.submissionName || overview.tier !== tier) fail("Submission overview identity differs.");
  const point = overview.operating_points?.find?.((entry) => entry?.name === leaderboard.operatingPointName);
  if (point?.overall_full_set !== dashboard.overallFullSet) fail("Submission overview score differs from dashboard evidence.");
  const tarball = verifyArtifact(root, leaderboard.tarball);
  verifyTar(packageRoot, tarball, packageFiles);
}
function verifyEvidence(evidencePath) {
  const canonicalEvidence = realpathSync(evidencePath);
  const root = dirname(canonicalEvidence);
  const evidence = exact(json(canonicalEvidence), ["schemaVersion", "official", "installation", "configuration", "hardware", "implementation", "runs", "combined", "leaderboard"], "evidence");
  if (evidence.schemaVersion !== "megasaver-lm2-official-evidence-v1") fail("Evidence schema version differs.");
  const official = exact(evidence.official, ["repository", "commit", "data"], "official");
  const data = exact(official.data, ["repoId", "revision", "preparationMode", "checksums", "validator"], "official.data");
  if (official.repository !== "https://github.com/xiaowu0162/LongMemEval-V2" || official.commit !== PIN.commit || data.repoId !== PIN.repoId || data.revision !== PIN.revision || !["symlink", "copy"].includes(data.preparationMode)) fail("Pinned official identity differs.");
  const checksums = exact(data.checksums, ["schema", "questions", "trajectories", "haystack"], "official.data.checksums");
  if (checksums.schema !== PIN.checksums.schema || checksums.questions !== PIN.checksums.questions || checksums.trajectories !== PIN.checksums.trajectories || ![PIN.checksums.small, PIN.checksums.medium].includes(checksums.haystack)) fail("Pinned data checksums differ.");
  const validator = exact(data.validator, ["command", "arguments", "exitCode", "stdoutSha256"], "official.data.validator");
  if (validator.command !== "data/validate_data.py" || validator.exitCode !== 0 || !Array.isArray(validator.arguments) || validator.arguments.length < 2 || !isDigest(validator.stdoutSha256)) fail("Official validator evidence differs.");
  const installation = exact(evidence.installation, ["preInstallState", "preInstallHashes", "postInstallDirtyPaths", "postInstallHashes", "postInstallDiffs"], "installation");
  if (!["baseline", "installed"].includes(installation.preInstallState) || JSON.stringify(installation.postInstallDirtyPaths) !== JSON.stringify(DIRTY_PATHS)) fail("Installer state differs.");
  for (const [name, digest] of Object.entries(PIN.officialFiles)) if (installation.preInstallHashes?.[name] !== digest) fail(`Pre-install hash differs: ${name}`);
  for (const value of Object.values(record(installation.postInstallHashes, "postInstallHashes"))) if (!isDigest(value)) fail("Post-install hash is invalid.");
  if (!Array.isArray(installation.postInstallDiffs) || JSON.stringify(installation.postInstallDiffs.map((entry) => entry.path)) !== JSON.stringify(DIRTY_PATHS) || installation.postInstallDiffs.some((entry) => !isDigest(entry.sha256))) fail("Post-install diff evidence differs.");
  const configuration = exact(evidence.configuration, ["reader", "judge", "embedding"], "configuration");
  modelConfig(configuration.reader, "reader"); modelConfig(configuration.judge, "judge"); modelConfig(configuration.embedding, "embedding", true);
  const hardware = exact(evidence.hardware, ["capturedAt", "os", "architecture", "cpuModel", "logicalCpuCount", "memoryBytes", "accelerators", "software"], "hardware");
  if (Number.isNaN(Date.parse(hardware.capturedAt)) || [hardware.os, hardware.architecture, hardware.cpuModel].some((value) => typeof value !== "string" || !value) || !Number.isInteger(hardware.logicalCpuCount) || hardware.logicalCpuCount < 1 || !Number.isInteger(hardware.memoryBytes) || hardware.memoryBytes < 1 || !Array.isArray(hardware.accelerators)) fail("Hardware evidence is incomplete.");
  exact(hardware.software, ["node", "python"], "hardware.software");
  const implementation = exact(evidence.implementation, ["megaSaverCommit", "adapter", "transport"], "implementation");
  if (!/^[0-9a-f]{40}$/u.test(implementation.megaSaverCommit)) fail("Mega Saver commit is invalid.");
  verifyArtifact(root, implementation.adapter); verifyArtifact(root, implementation.transport);
  if (!Array.isArray(evidence.runs) || evidence.runs.length !== 2) fail("Both domain runs are required.");
  const domains = new Set(); let tier;
  for (const runValue of evidence.runs) {
    const run = exact(runValue, ["domain", "tier", "command", "arguments", "outputDirectory", "runArgs", "aggregatedMetrics", "perQuestion", "runtimeInputs", "telemetry", "rawLatencySamplesSeconds", "failures"], "run");
    if (!["web", "enterprise"].includes(run.domain) || domains.has(run.domain) || !["small", "medium"].includes(run.tier) || (tier && tier !== run.tier)) fail("Run domain/tier pairing differs.");
    domains.add(run.domain); tier = run.tier;
    if (typeof run.command !== "string" || !run.command || !Array.isArray(run.arguments) || run.arguments.length < 1 || !run.arguments.includes(run.domain) || !run.arguments.includes(run.tier) || !Array.isArray(run.failures)) fail("Complete run arguments/failures are missing.");
    resolveInside(root, run.outputDirectory, true);
    const runArgs = record(json(verifyArtifact(root, run.runArgs)), "run_args");
    if (runArgs.domain !== run.domain || runArgs.tier !== run.tier || typeof runArgs.method !== "string" || !String(runArgs.model).toLowerCase().includes("qwen3.5-9b") || !String(runArgs.evaluator_model).toLowerCase().includes("gpt-5.2") || configuration.reader.model !== runArgs.model || configuration.judge.model !== runArgs.evaluator_model) fail("Run arguments do not match official inputs.");
    const runtimeInputs = exact(run.runtimeInputs, ["questions", "haystack", "memoryConfig"], "runtimeInputs"); const memoryConfig = record(json(verifyArtifact(root, runtimeInputs.memoryConfig)), "memory config"); const memoryParams = record(memoryConfig.memory_params, "memory params"); if (memoryConfig.memory_type !== "megasaver_lm2_hybrid" || memoryParams.data_revision !== PIN.revision || memoryParams.profile !== "adaptive" || memoryParams.embedding_egress !== "local" || JSON.stringify(memoryParams.model) !== JSON.stringify({ provider: configuration.embedding.provider, modelId: configuration.embedding.model, ...configuration.embedding.parameters })) fail("Embedding configuration differs from official runtime input.");
    const runMetrics = record(json(verifyArtifact(root, run.aggregatedMetrics)), "run metrics"); const questions = verifyArtifact(root, runtimeInputs.questions); verifyArtifact(root, runtimeInputs.haystack);
    const perQuestion = jsonl(verifyArtifact(root, run.perQuestion, true));
    if (perQuestion.length !== run.perQuestion.rowCount || json(questions).length !== perQuestion.length) fail("Per-question output coverage differs.");
    const telemetry = jsonl(verifyArtifact(root, run.telemetry, true));
    if (telemetry.length !== run.telemetry.rowCount || telemetry.some((row) => Object.keys(record(row, "telemetry row")).some((key) => !TELEMETRY_KEYS.has(key)) || TELEMETRY_REQUIRED.some((key) => !Object.hasOwn(row, key)))) fail("Public telemetry is invalid.");
    for (const row of telemetry) numeric(row.latencyMs, "telemetry latencyMs");
    const samples = perQuestion.map((row) => row.memory_query_duration_seconds); if (!Array.isArray(run.rawLatencySamplesSeconds) || JSON.stringify(samples) !== JSON.stringify(run.rawLatencySamplesSeconds)) fail("Raw latency samples differ from official per-question output.");
    for (const sample of samples) numeric(sample, "memory_query_duration_seconds");
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length; if (Math.abs(runMetrics.memory_query?.avg_seconds - average) > 1e-12) fail("Aggregated query latency differs from raw samples.");
    for (const failure of run.failures) { const item = exact(failure, FAILURE_KEYS, "failure"); if (![item.questionId, item.stage, item.code].every((value) => typeof value === "string" && value) || !isDigest(item.messageSha256)) fail("Failure evidence is invalid."); }
  }
  if (domains.size !== 2 || (tier === "small" ? checksums.haystack !== PIN.checksums.small : checksums.haystack !== PIN.checksums.medium) || JSON.stringify(validator.arguments) !== JSON.stringify(["--tier", tier])) fail("Pinned tier evidence differs.");
  const combined = exact(evidence.combined, ["metrics", "dashboard"], "combined"); const metrics = json(verifyArtifact(root, combined.metrics));
  const dashboard = exact(combined.dashboard, ["overallFullSet", "gotchasAccuracy", "staticAccuracy", "dynamicAccuracy", "procedureAccuracy"], "dashboard");
  const expectedDashboard = [metric(metrics, ["overall", "overall_full_set"]), metric(metrics, ["non_abstention_by_category", "gotchas", "pct_correct"]), metric(metrics, ["combined_abstention_by_category", "static", "pct_correct"]), metric(metrics, ["combined_abstention_by_category", "dynamic", "pct_correct"]), metric(metrics, ["combined_abstention_by_category", "procedure", "pct_correct"])];
  if (JSON.stringify(Object.values(dashboard)) !== JSON.stringify(expectedDashboard)) fail("Five dashboard values differ from combined metrics.");
  const leaderboard = exact(evidence.leaderboard, ["submissionName", "operatingPointName", "systemDescription", "codeArtifact", "packageDirectory", "packageFiles", "submissionOverview", "tarball", "step1", "step2"], "leaderboard");
  verifyArtifact(root, leaderboard.systemDescription); verifyArtifact(root, leaderboard.codeArtifact);
  if (leaderboard.codeArtifact.sha256 !== implementation.adapter.sha256) fail("Leaderboard code and adapter digests differ.");
  for (const name of ["step1", "step2"]) { const step = exact(leaderboard[name], ["exitCode", "arguments"], name); if (step.exitCode !== 0 || !Array.isArray(step.arguments) || step.arguments.length < 4) fail(`${name} did not succeed.`); }
  verifyPackage(root, leaderboard, tier, dashboard);
  return { evidence, root, tier, dashboard, leaderboard, installation, validator, runs: evidence.runs };
}
function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
}
function verifyOfficialCheckout(path, complete, inspected) {
  const root = realpathSync(path);
  if (git(root, ["rev-parse", "HEAD"]) !== PIN.commit) fail("Official checkout commit mismatch.");
  for (const [name, digest] of Object.entries(PIN.officialFiles)) if (name !== "memory_modules/memory.py" && fileSha256(join(root, name)) !== digest) fail(`Official file hash mismatch: ${name}`);
  const lines = git(root, ["status", "--porcelain"]); const dirty = lines ? lines.split("\n").map((line) => line.slice(3)) : [];
  if (!complete) { if (dirty.length !== 0) fail("Official preflight checkout is not pristine."); if (fileSha256(join(root, "memory_modules/memory.py")) !== PIN.officialFiles["memory_modules/memory.py"]) fail("Official memory baseline differs."); return root; }
  if (JSON.stringify([...dirty].sort()) !== JSON.stringify([...DIRTY_PATHS].sort())) fail("Installed checkout diff allowlist differs.");
  const memory = readFileSync(join(root, "memory_modules/memory.py"), "utf8");
  if (memory.split(IMPORT_LINE).length !== 2 || sha256(Buffer.from(memory.replace(IMPORT_LINE, ""))) !== PIN.officialFiles["memory_modules/memory.py"]) fail("Installed memory.py cannot restore to baseline.");
  const current = { "memory_modules/memory.py": fileSha256(join(root, "memory_modules/memory.py")), "memory_modules/megasaver_lm2_hybrid.py": fileSha256(join(root, "memory_modules/megasaver_lm2_hybrid.py")) };
  for (const [name, digest] of Object.entries(current)) if (inspected.installation.postInstallHashes[name] !== digest) fail(`Post-install hash differs: ${name}`);
  if (current["memory_modules/megasaver_lm2_hybrid.py"] !== inspected.evidence.implementation.adapter.sha256) fail("Installed adapter digest differs.");
  const diffDigests = { "memory_modules/megasaver_lm2_hybrid.py": current["memory_modules/megasaver_lm2_hybrid.py"], "memory_modules/memory.py": sha256(execFileSync("git", ["diff", "--binary", "--no-ext-diff", "--", "memory_modules/memory.py"], { cwd: root })) };
  for (const entry of inspected.installation.postInstallDiffs) if (diffDigests[entry.path] !== entry.sha256) fail(`Post-install diff digest differs: ${entry.path}`);
  return root;
}
async function fileDigest(path) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex");
}
async function verifyData(officialRoot, dataRoot, inspected, python) {
  const root = realpathSync(dataRoot); const names = { schema: "SCHEMA.md", questions: "questions.jsonl", trajectories: "trajectories.jsonl", haystack: `haystacks/lme_v2_${inspected.tier}.json` };
  for (const [name, file] of Object.entries(names)) if ((await fileDigest(resolveInside(root, file))) !== inspected.evidence.official.data.checksums[name]) fail(`Data checksum mismatch: ${name}`);
  const output = execFileSync(python, [join(officialRoot, "data/validate_data.py"), "--data-root", root, "--tier", inspected.tier], { cwd: officialRoot });
  if (sha256(output) !== inspected.validator.stdoutSha256) fail("Official validator output digest differs.");
}
function verifyOfficialAggregates(officialRoot, inspected, python) {
  const code = "import json,sys; from evaluation.harness import aggregate_metrics; rows=[json.loads(x) for x in open(sys.argv[1],encoding='utf-8') if x.strip()]; print(json.dumps(aggregate_metrics(rows)))";
  for (const run of inspected.runs) { const computed = JSON.parse(execFileSync(python, ["-c", code, resolveInside(inspected.root, run.perQuestion.path)], { cwd: officialRoot, encoding: "utf8" })); const recorded = json(resolveInside(inspected.root, run.aggregatedMetrics.path)); for (const key of ["overall", "non_abstention_by_category", "abstention_by_category", "combined_abstention_by_category", "abstention_overall"]) if (!isDeepStrictEqual(computed[key], recorded[key])) fail(`Hand-authored aggregate differs: ${run.domain}.${key}`); }
}
function expectedBuilderArgs(inspected) {
  const byDomain = Object.fromEntries(inspected.runs.map((run) => [run.domain, run.outputDirectory]));
  const step1 = [byDomain.web, byDomain.enterprise, inspected.leaderboard.submissionName, inspected.leaderboard.operatingPointName, inspected.tier, "--method", "megasaver_lm2_hybrid", "--output-root", "leaderboard"];
  const step2 = [inspected.leaderboard.submissionName, inspected.leaderboard.systemDescription.path, inspected.leaderboard.codeArtifact.path, `leaderboard/${inspected.leaderboard.submissionName}/operating_points/${inspected.leaderboard.operatingPointName}`, "--output-root", "leaderboard"];
  if (JSON.stringify(inspected.leaderboard.step1.arguments) !== JSON.stringify(step1) || JSON.stringify(inspected.leaderboard.step2.arguments) !== JSON.stringify(step2)) fail("Recorded official builder arguments differ.");
  return { step1, step2 };
}
function runBuilders(officialRoot, inspected, python) {
  const temp = mkdtempSync(join(tmpdir(), "megasaver-lm2-official-gate-"));
  try {
    const outputRoot = join(temp, "leaderboard"); const args = expectedBuilderArgs(inspected);
    const absolute = (value) => resolveInside(inspected.root, value, value.startsWith("runs/") || value.includes("operating_points"));
    const step1 = [absolute(args.step1[0]), absolute(args.step1[1]), ...args.step1.slice(2, 7), "--output-root", outputRoot];
    execFileSync(python, [join(officialRoot, "leaderboard/build_submission_step_1_single_operating_point.py"), ...step1], { cwd: officialRoot, stdio: "pipe" });
    const point = join(outputRoot, inspected.leaderboard.submissionName, "operating_points", inspected.leaderboard.operatingPointName);
    const step2 = [inspected.leaderboard.submissionName, absolute(args.step2[1]), absolute(args.step2[2]), point, "--output-root", outputRoot];
    execFileSync(python, [join(officialRoot, "leaderboard/build_submission_step_2_build_package.py"), ...step2], { cwd: officialRoot, stdio: "pipe" });
    const packageRoot = join(outputRoot, inspected.leaderboard.submissionName); const overview = json(join(packageRoot, "submission_overview.json"));
    const pointOverview = json(join(point, "metric_overview.json"));
    if (pointOverview.overall_full_set !== inspected.dashboard.overallFullSet || pointOverview.gotchas_accuracy !== inspected.dashboard.gotchasAccuracy || pointOverview.static_accuracy !== inspected.dashboard.staticAccuracy || pointOverview.dynamic_accuracy !== inspected.dashboard.dynamicAccuracy || pointOverview.procedure_accuracy !== inspected.dashboard.procedureAccuracy || overview.operating_points?.[0]?.overall_full_set !== inspected.dashboard.overallFullSet) fail("Fresh official builder dashboard differs.");
    const archive = join(outputRoot, `${inspected.leaderboard.submissionName}.tar.gz`); const packageFiles = walkFiles(packageRoot); verifyTar(packageRoot, archive, packageFiles);
    return { packageFileCount: packageFiles.length, tarballSha256: fileSha256(archive), submissionOverviewSha256: fileSha256(join(packageRoot, "submission_overview.json")) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function parseArgs(argv) {
  const args = { inspect: false, preflight: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--inspect" || flag === "--preflight") args[flag.slice(2)] = true;
    else { const value = argv[index + 1]; if (!flag?.startsWith("--") || value === undefined) fail("Invalid verifier arguments."); args[flag.slice(2)] = value; index += 1; }
  }
  return args;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.preflight) { if (!args["official-root"] || args.evidence || args.inspect) fail("Preflight requires only --official-root."); const root = verifyOfficialCheckout(args["official-root"], false); process.stdout.write(`${JSON.stringify({ officialCheckoutValid: true, officialCommit: PIN.commit, officialRoot: root, officialScoreEligible: false })}\n`); return; }
  if (!args.evidence) fail("--evidence is required."); const inspected = verifyEvidence(args.evidence);
  if (args.inspect) { if (args["official-root"] || args["data-root"]) fail("Inspect mode accepts only evidence."); process.stdout.write(`${JSON.stringify({ valid: true, officialScoreEligible: false })}\n`); return; }
  if (!args["official-root"] || !args["data-root"]) fail("Full verification requires --official-root and --data-root.");
  const officialRoot = verifyOfficialCheckout(args["official-root"], true, inspected); const python = args.python ?? "python3";
  await verifyData(officialRoot, args["data-root"], inspected, python); verifyOfficialAggregates(officialRoot, inspected, python); const builderArtifacts = runBuilders(officialRoot, inspected, python);
  process.stdout.write(`${JSON.stringify({ valid: true, officialScoreEligible: true, officialCommit: PIN.commit, dataRevision: PIN.revision, tier: inspected.tier, dashboard: inspected.dashboard, builderArtifacts })}\n`);
}
main().catch((error) => { process.stderr.write(`Evidence gate failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });
}
