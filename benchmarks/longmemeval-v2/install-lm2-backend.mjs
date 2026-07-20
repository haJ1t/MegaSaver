#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(SCRIPT_DIRECTORY, "official-contract-6f020ac2.json");
const BACKEND_RELATIVE = "memory_modules/megasaver_lm2_hybrid.py";
const MEMORY_RELATIVE = "memory_modules/memory.py";
const IMPORT_LINE =
  "from .megasaver_lm2_hybrid import MegaSaverLm2HybridMemory  # MEGASAVER_LM2_BACKEND_IMPORT\n";

function fail(message) {
  throw new Error(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Unsafe installer file: ${path}`);
  return digest(readFileSync(path));
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail("Invalid installer arguments.");
    values[flag.slice(2)] = value;
  }
  if (
    Object.keys(values).some((key) => !["checkout", "backend"].includes(key)) ||
    typeof values.checkout !== "string" ||
    typeof values.backend !== "string" ||
    !isAbsolute(values.checkout) ||
    !isAbsolute(values.backend)
  ) {
    fail("Installer requires absolute --checkout and --backend paths.");
  }
  return values;
}

function git(checkout, args) {
  return execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trimEnd();
}

function porcelainLines(checkout) {
  const output = git(checkout, ["status", "--porcelain"]);
  return output ? output.split("\n") : [];
}

function verifyProtected(checkout, contract) {
  for (const [name, expected] of Object.entries(contract.files)) {
    if (name === MEMORY_RELATIVE) continue;
    if (fileDigest(join(checkout, name)) !== expected) fail(`Official file hash mismatch: ${name}`);
  }
}

function installedState(checkout, backendDigest, contract) {
  const lines = porcelainLines(checkout);
  if (lines.length === 0) return "baseline";
  const expected = [" M memory_modules/memory.py", "?? memory_modules/megasaver_lm2_hybrid.py"];
  if (JSON.stringify(lines) !== JSON.stringify(expected))
    fail("Checkout has non-allowlisted changes.");
  const backendPath = join(checkout, BACKEND_RELATIVE);
  if (fileDigest(backendPath) !== backendDigest) fail("Installed backend bytes differ.");
  const memory = readFileSync(join(checkout, MEMORY_RELATIVE), "utf8");
  if (memory.split(IMPORT_LINE).length !== 2) fail("Installed backend import marker differs.");
  if (
    digest(Buffer.from(memory.replace(IMPORT_LINE, ""), "utf8")) !== contract.files[MEMORY_RELATIVE]
  ) {
    fail("Installed memory.py does not restore to the baseline.");
  }
  return "installed";
}

function atomicWrite(path, bytes, mode) {
  const temporary = `${path}.megasaver-installing`;
  writeFileSync(temporary, bytes, { flag: "wx", mode });
  renameSync(temporary, path);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checkout = realpathSync(args.checkout);
  const backend = realpathSync(args.backend);
  if (resolve(checkout) !== checkout || resolve(backend) !== backend)
    fail("Installer paths are not canonical.");
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  if (git(checkout, ["rev-parse", "HEAD"]) !== contract.officialCommit) {
    fail("Official checkout commit mismatch.");
  }
  verifyProtected(checkout, contract);
  const backendBytes = readFileSync(backend);
  const backendDigest = digest(backendBytes);
  const state = installedState(checkout, backendDigest, contract);
  const preInstallHashes = Object.fromEntries(
    Object.keys(contract.files).map((name) => [name, fileDigest(join(checkout, name))]),
  );
  if (state === "installed")
    preInstallHashes[BACKEND_RELATIVE] = fileDigest(join(checkout, BACKEND_RELATIVE));
  const memoryPath = join(checkout, MEMORY_RELATIVE);
  if (state === "baseline") {
    if (fileDigest(memoryPath) !== contract.files[MEMORY_RELATIVE]) {
      fail("Official memory.py baseline hash mismatch.");
    }
    atomicWrite(join(checkout, BACKEND_RELATIVE), backendBytes, 0o644);
    atomicWrite(
      memoryPath,
      Buffer.concat([readFileSync(memoryPath), Buffer.from(IMPORT_LINE)]),
      0o644,
    );
  }
  verifyProtected(checkout, contract);
  const postLines = porcelainLines(checkout);
  const postState = installedState(checkout, backendDigest, contract);
  if (postState !== "installed") fail("Installer post-state is invalid.");
  process.stdout.write(
    `${JSON.stringify({
      officialCommit: contract.officialCommit,
      preInstallState: state,
      preInstallHashes,
      postInstallDirtyPaths: postLines.map((line) => line.slice(3)),
      postInstallHashes: {
        [MEMORY_RELATIVE]: fileDigest(memoryPath),
        [BACKEND_RELATIVE]: fileDigest(join(checkout, BACKEND_RELATIVE)),
      },
    })}\n`,
  );
}

main();
