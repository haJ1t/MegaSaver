import { randomBytes } from "node:crypto";
import { fsyncSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flockSync } from "fs-ext";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./lm2-benchmark-canonical.js";
import { type BenchmarkManifest, parseBenchmarkManifest } from "./lm2-benchmark-manifest.js";
import { type BenchmarkConfig, BenchmarkTransportError } from "./lm2-benchmark-protocol.js";
import {
  type SafeBenchmarkDirectoryPath,
  type SafeBenchmarkFilePath,
  closeSafeBenchmarkPath,
  openSafeBenchmarkPath,
  verifySafeBenchmarkPath,
} from "./lm2-benchmark-safe-path.js";
import { syncDirectoryDescriptor } from "./lm2-secure-fs.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const chainEntrySchema = z
  .object({ id: z.string().min(1), fullObjectDigest: sha256Schema })
  .strict();
const controlSchema = z
  .object({
    schemaVersion: z.literal("megasaver-lm2-run-v1"),
    manifestDigest: sha256Schema,
    dataRevision: z.string(),
    instanceToken: tokenSchema,
    sentinelToken: tokenSchema,
    device: z.string(),
    inode: z.string(),
    lockDevice: z.string(),
    lockInode: z.string(),
    chain: z.array(chainEntrySchema),
    chainDigest: sha256Schema,
  })
  .strict();
export type BenchmarkRunControl = z.infer<typeof controlSchema>;

export type BenchmarkRunHandle = {
  root: SafeBenchmarkDirectoryPath;
  lock: SafeBenchmarkFilePath;
};

function readCanonical(path: string): unknown {
  const file = openSafeBenchmarkPath(path, "read");
  let raw: string;
  try {
    raw = readFileSync(file.descriptor, "utf8");
    verifySafeBenchmarkPath(file, "read");
  } finally {
    closeSafeBenchmarkPath(file);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BenchmarkTransportError("state_rejected");
  }
  if (raw !== `${canonicalJson(value)}\n`) throw new BenchmarkTransportError("state_rejected");
  return value;
}

export function readBenchmarkManifest(config: BenchmarkConfig): BenchmarkManifest {
  let manifest: BenchmarkManifest;
  try {
    manifest = parseBenchmarkManifest(readCanonical(config.manifestPath));
  } catch (error) {
    if (error instanceof BenchmarkTransportError) throw error;
    throw new BenchmarkTransportError("invalid_config");
  }
  if (
    canonicalSha256(manifest) !== config.manifestDigest ||
    manifest.data.revision !== config.dataRevision
  ) {
    throw new BenchmarkTransportError("invalid_config");
  }
  return manifest;
}

export function benchmarkRunRoot(config: BenchmarkConfig, instanceToken: string): string {
  return join(config.cacheParent, `instance-${instanceToken}`);
}

function writeExclusive(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
  const file = openSafeBenchmarkPath(path, "update");
  try {
    fsyncSync(file.descriptor);
    verifySafeBenchmarkPath(file, "update");
  } finally {
    closeSafeBenchmarkPath(file);
  }
}

export function createBenchmarkRun(input: {
  config: BenchmarkConfig;
  instanceToken: string;
}): BenchmarkRunControl {
  const cacheParent = openSafeBenchmarkPath(input.config.cacheParent, "directory");
  const root = benchmarkRunRoot(input.config, input.instanceToken);
  try {
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(join(root, "cache"), { mode: 0o700 });
    mkdirSync(join(root, "telemetry"), { mode: 0o700 });
    writeFileSync(join(root, "run.lock"), "", { flag: "wx", mode: 0o600 });
    writeFileSync(join(root, "telemetry", "queries.jsonl"), "", { flag: "wx", mode: 0o600 });
  } catch {
    closeSafeBenchmarkPath(cacheParent);
    throw new BenchmarkTransportError("state_rejected");
  }
  const safeRoot = openSafeBenchmarkPath(root, "directory");
  const lock = openSafeBenchmarkPath(join(root, "run.lock"), "read");
  const sentinelToken = randomBytes(16).toString("hex");
  const chain: BenchmarkRunControl["chain"] = [];
  const control: BenchmarkRunControl = {
    schemaVersion: "megasaver-lm2-run-v1",
    manifestDigest: input.config.manifestDigest,
    dataRevision: input.config.dataRevision,
    instanceToken: input.instanceToken,
    sentinelToken,
    device: safeRoot.identity.device,
    inode: safeRoot.identity.inode,
    lockDevice: lock.identity.device,
    lockInode: lock.identity.inode,
    chain,
    chainDigest: canonicalSha256(chain),
  };
  writeExclusive(join(root, "sentinel.json"), control);
  writeExclusive(join(root, "control.json"), control);
  if (safeRoot.descriptor !== null) syncDirectoryDescriptor(safeRoot.descriptor);
  if (cacheParent.descriptor !== null) syncDirectoryDescriptor(cacheParent.descriptor);
  closeSafeBenchmarkPath(lock);
  closeSafeBenchmarkPath(safeRoot);
  closeSafeBenchmarkPath(cacheParent);
  return control;
}

function validateRun(input: {
  config: BenchmarkConfig;
  instanceToken: string;
  sentinelToken: string;
  handle: BenchmarkRunHandle;
}): BenchmarkRunControl {
  verifySafeBenchmarkPath(input.handle.root, "directory");
  verifySafeBenchmarkPath(input.handle.lock, "update");
  const root = input.handle.root.path;
  for (const directory of [join(root, "cache"), join(root, "telemetry")]) {
    const safe = openSafeBenchmarkPath(directory, "directory");
    closeSafeBenchmarkPath(safe);
  }
  const telemetry = openSafeBenchmarkPath(join(root, "telemetry", "queries.jsonl"), "read");
  closeSafeBenchmarkPath(telemetry);
  const sentinel = controlSchema.parse(readCanonical(join(root, "sentinel.json")));
  const control = controlSchema.parse(readCanonical(join(root, "control.json")));
  const identityMatches = (value: BenchmarkRunControl) =>
    value.manifestDigest === input.config.manifestDigest &&
    value.dataRevision === input.config.dataRevision &&
    value.instanceToken === input.instanceToken &&
    value.sentinelToken === input.sentinelToken &&
    value.device === input.handle.root.identity.device &&
    value.inode === input.handle.root.identity.inode &&
    value.lockDevice === input.handle.lock.identity.device &&
    value.lockInode === input.handle.lock.identity.inode &&
    value.chainDigest === canonicalSha256(value.chain);
  if (
    !identityMatches(sentinel) ||
    sentinel.chain.length !== 0 ||
    sentinel.chainDigest !== canonicalSha256([]) ||
    !identityMatches(control)
  ) {
    throw new BenchmarkTransportError("state_rejected");
  }
  return control;
}

export async function withBenchmarkRunLock<T>(input: {
  config: BenchmarkConfig;
  instanceToken: string;
  sentinelToken: string;
  run(handle: BenchmarkRunHandle, control: BenchmarkRunControl): Promise<T>;
}): Promise<T> {
  const root = benchmarkRunRoot(input.config, input.instanceToken);
  const safeRoot = openSafeBenchmarkPath(root, "directory");
  let lock: SafeBenchmarkFilePath;
  try {
    lock = openSafeBenchmarkPath(join(root, "run.lock"), "update");
  } catch (error) {
    closeSafeBenchmarkPath(safeRoot);
    throw error;
  }
  const handle = { root: safeRoot, lock };
  try {
    flockSync(lock.descriptor, "ex");
    let control: BenchmarkRunControl;
    try {
      control = validateRun({ ...input, handle });
    } catch (error) {
      if (error instanceof BenchmarkTransportError) throw error;
      throw new BenchmarkTransportError("state_rejected");
    }
    return await input.run(handle, control);
  } finally {
    try {
      flockSync(lock.descriptor, "un");
    } finally {
      closeSafeBenchmarkPath(lock);
      closeSafeBenchmarkPath(safeRoot);
    }
  }
}

export function assertBenchmarkRunIdentity(handle: BenchmarkRunHandle): void {
  verifySafeBenchmarkPath(handle.root, "directory");
  verifySafeBenchmarkPath(handle.lock, "update");
}

export function replaceBenchmarkControl(
  handle: BenchmarkRunHandle,
  control: BenchmarkRunControl,
): void {
  assertBenchmarkRunIdentity(handle);
  const temporary = join(handle.root.path, "control.next");
  writeExclusive(temporary, control);
  assertBenchmarkRunIdentity(handle);
  renameSync(temporary, join(handle.root.path, "control.json"));
  const replacement = openSafeBenchmarkPath(join(handle.root.path, "control.json"), "read");
  closeSafeBenchmarkPath(replacement);
  if (handle.root.descriptor !== null) syncDirectoryDescriptor(handle.root.descriptor);
  assertBenchmarkRunIdentity(handle);
}

export function appendBenchmarkTelemetry(handle: BenchmarkRunHandle, value: unknown): void {
  assertBenchmarkRunIdentity(handle);
  const path = join(handle.root.path, "telemetry", "queries.jsonl");
  const file = openSafeBenchmarkPath(path, "append");
  try {
    writeFileSync(file.descriptor, `${canonicalJson(value)}\n`);
    fsyncSync(file.descriptor);
    verifySafeBenchmarkPath(file, "append");
  } finally {
    closeSafeBenchmarkPath(file);
  }
  assertBenchmarkRunIdentity(handle);
}
