import { randomBytes } from "node:crypto";
import {
  constants,
  type Stats,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { flockSync } from "fs-ext";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./lm2-benchmark-canonical.js";
import { type BenchmarkManifest, parseBenchmarkManifest } from "./lm2-benchmark-manifest.js";
import { type BenchmarkConfig, BenchmarkTransportError } from "./lm2-benchmark-protocol.js";

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
    chain: z.array(chainEntrySchema),
    chainDigest: sha256Schema,
  })
  .strict();
export type BenchmarkRunControl = z.infer<typeof controlSchema>;

function exactMode(stats: Stats, mode: number): boolean {
  return (stats.mode & 0o777) === mode;
}

function sameOwner(stats: Stats): boolean {
  return typeof process.geteuid !== "function" || stats.uid === process.geteuid();
}

function safeDirectory(path: string): Stats {
  const stats = lstatSync(path);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !exactMode(stats, 0o700) ||
    !sameOwner(stats)
  ) {
    throw new BenchmarkTransportError("state_rejected");
  }
  return stats;
}

function safeFile(path: string): Stats {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || !exactMode(stats, 0o600) || !sameOwner(stats)) {
    throw new BenchmarkTransportError("state_rejected");
  }
  return stats;
}

function readCanonical(path: string): unknown {
  safeFile(path);
  const raw = readFileSync(path, "utf8");
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
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function createBenchmarkRun(input: {
  config: BenchmarkConfig;
  instanceToken: string;
}): BenchmarkRunControl {
  safeDirectory(input.config.cacheParent);
  const root = benchmarkRunRoot(input.config, input.instanceToken);
  try {
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(join(root, "cache"), { mode: 0o700 });
    mkdirSync(join(root, "telemetry"), { mode: 0o700 });
    writeFileSync(join(root, "run.lock"), "", { flag: "wx", mode: 0o600 });
    writeFileSync(join(root, "telemetry", "queries.jsonl"), "", { flag: "wx", mode: 0o600 });
  } catch {
    throw new BenchmarkTransportError("state_rejected");
  }
  const stats = safeDirectory(root);
  const sentinelToken = randomBytes(16).toString("hex");
  const chain: BenchmarkRunControl["chain"] = [];
  const control: BenchmarkRunControl = {
    schemaVersion: "megasaver-lm2-run-v1",
    manifestDigest: input.config.manifestDigest,
    dataRevision: input.config.dataRevision,
    instanceToken: input.instanceToken,
    sentinelToken,
    device: String(stats.dev),
    inode: String(stats.ino),
    chain,
    chainDigest: canonicalSha256(chain),
  };
  writeExclusive(join(root, "sentinel.json"), control);
  writeExclusive(join(root, "control.json"), control);
  return control;
}

function validateRun(input: {
  config: BenchmarkConfig;
  instanceToken: string;
  sentinelToken: string;
}): { root: string; control: BenchmarkRunControl } {
  safeDirectory(input.config.cacheParent);
  const root = benchmarkRunRoot(input.config, input.instanceToken);
  const stats = safeDirectory(root);
  safeDirectory(join(root, "cache"));
  safeDirectory(join(root, "telemetry"));
  safeFile(join(root, "run.lock"));
  safeFile(join(root, "telemetry", "queries.jsonl"));
  const sentinel = controlSchema.parse(readCanonical(join(root, "sentinel.json")));
  const control = controlSchema.parse(readCanonical(join(root, "control.json")));
  const identityMatches = (value: BenchmarkRunControl) =>
    value.manifestDigest === input.config.manifestDigest &&
    value.dataRevision === input.config.dataRevision &&
    value.instanceToken === input.instanceToken &&
    value.sentinelToken === input.sentinelToken &&
    value.device === String(stats.dev) &&
    value.inode === String(stats.ino) &&
    value.chainDigest === canonicalSha256(value.chain);
  if (!identityMatches(sentinel) || !identityMatches(control)) {
    throw new BenchmarkTransportError("state_rejected");
  }
  return { root, control };
}

export async function withBenchmarkRunLock<T>(input: {
  config: BenchmarkConfig;
  instanceToken: string;
  sentinelToken: string;
  run(root: string, control: BenchmarkRunControl): Promise<T>;
}): Promise<T> {
  const root = benchmarkRunRoot(input.config, input.instanceToken);
  const descriptor = openSync(join(root, "run.lock"), constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    flockSync(descriptor, "ex");
    let validated: ReturnType<typeof validateRun>;
    try {
      validated = validateRun(input);
    } catch (error) {
      if (error instanceof BenchmarkTransportError) throw error;
      throw new BenchmarkTransportError("state_rejected");
    }
    return await input.run(validated.root, validated.control);
  } finally {
    try {
      flockSync(descriptor, "un");
    } finally {
      closeSync(descriptor);
    }
  }
}

export function replaceBenchmarkControl(root: string, control: BenchmarkRunControl): void {
  const temporary = join(root, "control.next");
  writeExclusive(temporary, control);
  renameSync(temporary, join(root, "control.json"));
  safeFile(join(root, "control.json"));
}

export function appendBenchmarkTelemetry(root: string, value: unknown): void {
  const path = join(root, "telemetry", "queries.jsonl");
  safeFile(path);
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    writeFileSync(descriptor, `${canonicalJson(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
