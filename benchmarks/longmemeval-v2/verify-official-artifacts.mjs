#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateEvidenceSchema } from "./evidence-schema-validator.mjs";
import { verifyRecordedArchive } from "./official-evidence-archive.mjs";
import { verifyFreshOfficialArtifacts } from "./official-evidence-freshness.mjs";
import { PIN } from "./official-evidence-pins.mjs";
import { officialCombinedTiming, verifyRunBindings } from "./official-evidence-run-bindings.mjs";
// biome-ignore format: The standalone gate is one responsibility and must stay below the repository's 300-line source limit.
{
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
function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)); const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  return leftPoints.length - rightPoints.length;
}
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).map((key) => key.normalize("NFC")).sort(compareCodePoints).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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
function verifyPackage(root, leaderboard, tier, dashboard) {
  const packageRoot = resolveInside(root, leaderboard.packageDirectory, true);
  if (!Array.isArray(leaderboard.packageFiles) || leaderboard.packageFiles.length < 19) fail("Package inventory is incomplete.");
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
      ["aggregated_metrics.json", "per_question.jsonl", "run_args.json", "runtime_inputs/questions.json", "runtime_inputs/haystack.json", "runtime_inputs/trajectories.jsonl", "runtime_inputs/memory_config.json", "runtime_inputs/megasaver-lm2-manifest-v1.json"].map((name) => `${op}/${domain}/${name}`),
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
  verifyRecordedArchive(packageRoot, tarball, packageFiles);
}
function verifyEvidence(evidencePath) {
  const canonicalEvidence = realpathSync(evidencePath);
  const root = dirname(canonicalEvidence);
  const evidenceValue = json(canonicalEvidence); validateEvidenceSchema(evidenceValue, join(import.meta.dirname, "evidence-schema.json"));
  const evidence = exact(evidenceValue, ["schemaVersion", "official", "installation", "configuration", "hardware", "implementation", "runs", "combined", "leaderboard"], "evidence");
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
  const implementation = exact(evidence.implementation, ["megaSaverCommit", "adapter", "transport", "transportExecutable"], "implementation");
  if (!/^[0-9a-f]{40}$/u.test(implementation.megaSaverCommit)) fail("Mega Saver commit is invalid.");
  verifyArtifact(root, implementation.adapter); const transportPath = verifyArtifact(root, implementation.transport);
  if (!isAbsolute(implementation.transportExecutable.path) || fileSha256(implementation.transportExecutable.path) !== implementation.transportExecutable.sha256) fail("Transport executable binding differs.");
  if (!Array.isArray(evidence.runs) || evidence.runs.length !== 2) fail("Both domain runs are required.");
  const domains = new Set(); const timingByDomain = new Map(); let tier;
  for (const runValue of evidence.runs) {
    const run = exact(runValue, ["domain", "tier", "command", "arguments", "outputDirectory", "runArgs", "aggregatedMetrics", "perQuestion", "runtimeInputs", "telemetry", "rawLatencySamplesSeconds", "failures"], "run");
    if (!["web", "enterprise"].includes(run.domain) || domains.has(run.domain) || !["small", "medium"].includes(run.tier) || (tier && tier !== run.tier)) fail("Run domain/tier pairing differs.");
    domains.add(run.domain); tier = run.tier;
    if (typeof run.command !== "string" || !run.command || !Array.isArray(run.arguments) || run.arguments.length < 1 || !run.arguments.includes(run.domain) || !Array.isArray(run.failures)) fail("Complete run arguments/failures are missing.");
    const outputDirectory = resolveInside(root, run.outputDirectory, true);
    const runArgs = record(json(verifyArtifact(root, run.runArgs)), "run_args");
    if (!String(runArgs.model).toLowerCase().includes("qwen3.5-9b") || !String(runArgs.evaluator_model).toLowerCase().includes("gpt-5.2")) fail("Run arguments do not match official models.");
    const runtimeInputs = exact(run.runtimeInputs, ["questions", "haystack", "trajectories", "memoryConfig", "manifest"], "runtimeInputs"); const memoryConfigPath = verifyArtifact(root, runtimeInputs.memoryConfig); const memoryConfig = record(json(memoryConfigPath), "memory config"); const memoryParams = record(memoryConfig.memory_params, "memory params");
    const manifestPath = verifyArtifact(root, runtimeInputs.manifest); const manifestBytes = readFileSync(manifestPath); const manifest = record(JSON.parse(manifestBytes), "manifest");
    const command = [implementation.transportExecutable.path, transportPath];
    if (memoryConfig.memory_type !== "megasaver_lm2_hybrid") fail("Runtime memory type differs.");
    if (memoryParams.manifest_path !== manifestPath) fail("Runtime manifest path binding differs.");
    if (memoryParams.manifest_digest !== sha256(Buffer.from(canonical(manifest)))) fail(`Runtime manifest digest binding differs: ${memoryParams.manifest_digest} != ${sha256(Buffer.from(canonical(manifest)))}`);
    if (memoryParams.data_revision !== PIN.revision || memoryParams.megasaver_commit !== implementation.megaSaverCommit) fail("Runtime revision binding differs.");
    if (JSON.stringify(memoryParams.transport_command) !== JSON.stringify(command)) fail("Runtime transport binding differs.");
    if (memoryParams.profile !== "adaptive" || memoryParams.embedding_egress !== "local" || JSON.stringify(memoryParams.model) !== JSON.stringify({ provider: configuration.embedding.provider, modelId: configuration.embedding.model, ...configuration.embedding.parameters })) fail("Embedding configuration differs from runtime input.");
    if (manifest.schemaVersion !== "megasaver-lm2-manifest-v1" || manifest.officialCommit !== PIN.commit || manifest.domain !== run.domain || manifest.tier !== run.tier || manifest.data?.revision !== PIN.revision || !isDeepStrictEqual(manifest.data?.checksums, checksums)) fail("Manifest identity differs.");
    const runMetrics = record(json(verifyArtifact(root, run.aggregatedMetrics)), "run metrics"); const questionsPath = verifyArtifact(root, runtimeInputs.questions); const haystackPath = verifyArtifact(root, runtimeInputs.haystack); const trajectoriesPath = verifyArtifact(root, runtimeInputs.trajectories);
    const perQuestion = jsonl(verifyArtifact(root, run.perQuestion, true)); const questionRows = json(questionsPath);
    if (perQuestion.length !== run.perQuestion.rowCount || questionRows.length !== perQuestion.length) fail("Per-question output coverage differs.");
    if (!Number.isInteger(runMetrics.overall?.count_all_questions) || runMetrics.overall.count_all_questions !== perQuestion.length) fail("Official timing question count differs.");
    timingByDomain.set(run.domain, { count: runMetrics.overall.count_all_questions, summary: runMetrics.memory_query });
    const telemetry = jsonl(verifyArtifact(root, run.telemetry, true));
    if (telemetry.length !== run.telemetry.rowCount || telemetry.some((row) => Object.keys(record(row, "telemetry row")).some((key) => !TELEMETRY_KEYS.has(key)) || TELEMETRY_REQUIRED.some((key) => !Object.hasOwn(row, key)))) fail("Public telemetry is invalid.");
    const questionIds = questionRows.map((row) => row.id); const outputIds = perQuestion.map((row) => row.question_id); const telemetryIds = telemetry.map((row) => row.questionId);
    if (new Set(questionIds).size !== questionIds.length || JSON.stringify(outputIds) !== JSON.stringify(questionIds) || JSON.stringify(telemetryIds) !== JSON.stringify(questionIds) || JSON.stringify(manifest.questions?.map((row) => row.questionId)) !== JSON.stringify(questionIds)) fail("Question identity binding differs.");
    verifyRunBindings({ command: run.command, domain: run.domain, arguments: run.arguments, outputDirectory, runArgs, paths: { questions: questionsPath, haystack: haystackPath, trajectories: trajectoriesPath, memoryConfig: memoryConfigPath }, questions: questionRows, haystack: json(haystackPath), trajectories: jsonl(trajectoriesPath), manifest, memoryParams, perQuestion, telemetry, configuration, canonicalSha256: (value) => sha256(Buffer.from(canonical(value))) });
    const samples = perQuestion.map((row) => row.memory_query_duration_seconds); if (!Array.isArray(run.rawLatencySamplesSeconds) || JSON.stringify(samples) !== JSON.stringify(run.rawLatencySamplesSeconds)) fail("Raw latency samples differ from official per-question output.");
    for (const sample of samples) numeric(sample, "memory_query_duration_seconds");
    const sorted = [...samples].sort((a, b) => a - b); const timing = { avg_seconds: samples.reduce((sum, value) => sum + value, 0) / samples.length, p50_seconds: sorted[Math.floor(sorted.length / 2)], p95_seconds: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max_seconds: sorted.at(-1), total_seconds: samples.reduce((sum, value) => sum + value, 0) };
    if (!isDeepStrictEqual(runMetrics.memory_query, timing)) fail("Aggregated query latency differs from raw samples.");
    for (const failure of run.failures) { const item = exact(failure, FAILURE_KEYS, "failure"); if (![item.questionId, item.stage, item.code].every((value) => typeof value === "string" && value) || !isDigest(item.messageSha256)) fail("Failure evidence is invalid."); }
  }
  if (domains.size !== 2 || (tier === "small" ? checksums.haystack !== PIN.checksums.small : checksums.haystack !== PIN.checksums.medium) || JSON.stringify(validator.arguments) !== JSON.stringify(["--tier", tier])) fail("Pinned tier evidence differs.");
  const combined = exact(evidence.combined, ["metrics", "dashboard"], "combined"); const metrics = json(verifyArtifact(root, combined.metrics)); const timingDomains = [timingByDomain.get("web"), timingByDomain.get("enterprise")]; if (!isDeepStrictEqual(metrics.memory_query, officialCombinedTiming(timingDomains))) fail("Combined query latency differs from the official contract.");
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
  const combineCode = "import json,sys; from pathlib import Path; from leaderboard.combine_aggregated_metrics import combine_metrics; value=combine_metrics(json.load(open(sys.argv[1])),json.load(open(sys.argv[2])),Path(sys.argv[1]),Path(sys.argv[2])); value['combined_at_utc']=sys.argv[3]; print(json.dumps(value))";
  const paths = Object.fromEntries(inspected.runs.map((run) => [run.domain, resolveInside(inspected.root, run.aggregatedMetrics.path)]));
  const recordedCombined = json(resolveInside(inspected.root, inspected.evidence.combined.metrics.path));
  if (!isDeepStrictEqual(recordedCombined.combined_from, [paths.web, paths.enterprise]) || Number.isNaN(Date.parse(recordedCombined.combined_at_utc))) fail("Official combined provenance differs.");
  const combined = JSON.parse(execFileSync(python, ["-c", combineCode, paths.web, paths.enterprise, recordedCombined.combined_at_utc], { cwd: officialRoot, encoding: "utf8" }));
  if (!isDeepStrictEqual(combined, recordedCombined)) fail("Official combined metrics differ.");
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
  const pythonExecutable = realpathSync(execFileSync(python, ["-c", "import os,sys; print(os.path.realpath(sys.executable))"], { encoding: "utf8" }).trim());
  for (const run of inspected.runs) if (realpathSync(run.command) !== pythonExecutable) fail("Recorded harness executable differs from verifier Python.");
  const dataRoot = realpathSync(args["data-root"]); await verifyData(officialRoot, dataRoot, inspected, python); verifyOfficialAggregates(officialRoot, inspected, python); const builderArtifacts = verifyFreshOfficialArtifacts({ officialRoot, dataRoot, repoRoot: resolve(import.meta.dirname, "../.."), inspected, python });
  process.stdout.write(`${JSON.stringify({ valid: true, officialScoreEligible: true, officialCommit: PIN.commit, dataRevision: PIN.revision, tier: inspected.tier, dashboard: inspected.dashboard, builderArtifacts })}\n`);
}
main().catch((error) => { process.stderr.write(`Evidence gate failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });
}
