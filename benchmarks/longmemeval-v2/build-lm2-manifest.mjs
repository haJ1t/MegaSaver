#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  createReadStream,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT = {
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
};

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail("Invalid arguments.");
    values[flag.slice(2)] = value;
  }
  const required = ["official-root", "data-root", "domain", "tier", "output"];
  if (Object.keys(values).some((key) => !required.includes(key))) fail("Unknown argument.");
  if (required.some((key) => typeof values[key] !== "string")) fail("Missing argument.");
  if (!isAbsolute(values.output)) fail("Output path must be absolute.");
  if (!["web", "enterprise"].includes(values.domain)) fail("Invalid domain.");
  if (!["small", "medium"].includes(values.tier)) fail("Invalid tier.");
  return values;
}

function safeInput(root, name) {
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) fail("Data input escapes its root.");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("Data input is not a regular file.");
  if (realpathSync(path) !== path) fail("Data input is not canonical.");
  return path;
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJsonl(path, select = () => true) {
  const rows = [];
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (select(row)) rows.push(row);
  }
  return rows;
}

function verifyCheckout(root) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (commit !== CONTRACT.officialCommit) fail("Official checkout commit mismatch.");
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "--", "data/validate_data.py", "data/public_data.py"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (dirty) fail("Official data validator is modified.");
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--contract") {
    process.stdout.write(`${JSON.stringify(CONTRACT)}\n`);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const officialRoot = realpathSync(args["official-root"]);
  const dataRoot = realpathSync(args["data-root"]);
  verifyCheckout(officialRoot);
  const paths = {
    schema: safeInput(dataRoot, "SCHEMA.md"),
    questions: safeInput(dataRoot, "questions.jsonl"),
    trajectories: safeInput(dataRoot, "trajectories.jsonl"),
    haystack: safeInput(dataRoot, `haystacks/lme_v2_${args.tier}.json`),
  };
  const expected = {
    schema: CONTRACT.checksums.schema,
    questions: CONTRACT.checksums.questions,
    trajectories: CONTRACT.checksums.trajectories,
    haystack: CONTRACT.checksums[args.tier],
  };
  for (const [name, path] of Object.entries(paths)) {
    if ((await fileSha256(path)) !== expected[name]) fail(`Checksum mismatch: ${name}`);
  }
  execFileSync(
    process.env.PYTHON ?? "python3",
    [join(officialRoot, "data/validate_data.py"), "--data-root", dataRoot, "--tier", args.tier],
    { cwd: officialRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  const questions = await readJsonl(paths.questions);
  const haystack = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(paths.haystack, "utf8")),
  );
  const selectedQuestions = questions.filter((question) => question.domain === args.domain);
  const referenced = new Set(selectedQuestions.flatMap((question) => haystack[question.id] ?? []));
  const trajectories = await readJsonl(paths.trajectories, (trajectory) =>
    referenced.has(trajectory.id),
  );
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const packageDist = resolve(scriptDirectory, "../../packages/long-memory/dist");
  const [{ buildBenchmarkManifest }, { canonicalJson, canonicalSha256 }] = await Promise.all([
    import(pathToFileURL(join(packageDist, "lm2-benchmark-manifest.js"))),
    import(pathToFileURL(join(packageDist, "lm2-benchmark-canonical.js"))),
  ]);
  const manifest = buildBenchmarkManifest({
    domain: args.domain,
    tier: args.tier,
    checksums: expected,
    questions,
    haystack,
    trajectories,
  });
  const output = resolve(args.output);
  const parentDescriptor = openSync(
    dirname(output),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  writeFileSync(output, `${canonicalJson(manifest)}\n`, { flag: "wx", mode: 0o600 });
  const outputDescriptor = openSync(output, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(outputDescriptor);
    fsyncSync(parentDescriptor);
  } finally {
    closeSync(outputDescriptor);
    closeSync(parentDescriptor);
  }
  process.stdout.write(
    `${JSON.stringify({ manifestPath: output, manifestDigest: canonicalSha256(manifest) })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Manifest build failed."}\n`);
  process.exitCode = 1;
});
