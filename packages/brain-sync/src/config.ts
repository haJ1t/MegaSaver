import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { z } from "zod";
import { atomicWriteFile } from "./atomic-write.js";
import { BrainSyncError } from "./errors.js";

export const CONFIG_FILE = "brain-sync.json";
export const KEYFILE_NAME = "brain-sync.key";

export const brainSyncConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    endpoint: z.string().url(),
    bucket: z.string().min(1),
    prefix: z.string(),
    region: z.string().min(1),
    pathStyle: z.boolean(),
    conditionalWritesVerified: z.literal(true),
    lastSeen: z.record(z.string().uuid(), z.number().int().nonnegative()),
  })
  .strict();

export type BrainSyncConfig = z.infer<typeof brainSyncConfigSchema>;

export function configPath(storeRoot: string): string {
  return join(storeRoot, CONFIG_FILE);
}

export function keyfilePath(storeRoot: string): string {
  return join(storeRoot, KEYFILE_NAME);
}

export function loadConfig(storeRoot: string): BrainSyncConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(storeRoot), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BrainSyncError(
        "config_invalid",
        "brain sync is not configured — run `mega brain sync init`",
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BrainSyncError("config_invalid", `${CONFIG_FILE} is not valid JSON`);
  }
  const result = brainSyncConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new BrainSyncError(
      "config_invalid",
      `${CONFIG_FILE} failed validation: ${result.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  return result.data;
}

export function saveConfig(storeRoot: string, config: BrainSyncConfig): void {
  atomicWriteFile(configPath(storeRoot), `${JSON.stringify(config, null, 2)}\n`);
}

export function updateLastSeen(storeRoot: string, projectId: string, generation: number): void {
  // ponytail: if the deadline passes under contention the write is skipped —
  // safe here, a stale-low lastSeen just triggers an idempotent re-pull next run.
  withFileLock(`${configPath(storeRoot)}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    if (!z.string().uuid().safeParse(projectId).success) {
      throw new BrainSyncError("config_invalid", `invalid project id for last-seen: ${projectId}`);
    }
    const config = loadConfig(storeRoot);
    saveConfig(storeRoot, { ...config, lastSeen: { ...config.lastSeen, [projectId]: generation } });
  });
}

export function assertSafeEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BrainSyncError("insecure_endpoint", `endpoint is not a valid URL: ${endpoint}`);
  }
  if (url.protocol === "https:") return;
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol === "http:" && localHosts.has(url.hostname)) return;
  throw new BrainSyncError(
    "insecure_endpoint",
    "endpoint must be https:// (http:// is allowed only for localhost MinIO dev)",
  );
}

export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `${trimmed}/`;
}
