import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compileGlob, redact } from "@megasaver/policy";
import { meshPaths } from "./paths.js";
import { listPeers } from "./presence.js";
import { CLAIM_TTL_MS, atomicWriteFileSync, quarantineFileSync, safeJsonParse } from "./store.js";
import {
  type ClaimRecord,
  SAFE_SEGMENT,
  claimRecordSchema,
  presenceRecordSchema,
} from "./types.js";

function isRepoRelative(path: string): boolean {
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  return true;
}

function pathOverlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const aHasGlob = a.includes("*") || a.includes("?");
  const bHasGlob = b.includes("*") || b.includes("?");
  if (aHasGlob) {
    try {
      const matcher = compileGlob(a);
      if (matcher.test(b)) return true;
    } catch {
      // fall through to exact
    }
  }
  if (bHasGlob) {
    try {
      const matcher = compileGlob(b);
      if (matcher.test(a)) return true;
    } catch {}
  }
  return false;
}

function sameScope(
  record: ClaimRecord,
  filter: { workspaceKey?: string; repositoryFamilyKey?: string },
): boolean {
  if (filter.workspaceKey === undefined && filter.repositoryFamilyKey === undefined) return true;
  const filterHasFamily = filter.repositoryFamilyKey !== undefined;
  const recordHasFamily = record.repositoryFamilyKey !== undefined;
  if (filterHasFamily && recordHasFamily) {
    return record.repositoryFamilyKey === filter.repositoryFamilyKey;
  }
  if (filter.workspaceKey === undefined) return false;
  return record.workspaceKey === filter.workspaceKey;
}

function loadPresenceForScope(
  storeRoot: string,
  liveSessionId: string,
): { workspaceKey?: string; repositoryFamilyKey?: string } | undefined {
  const filePath = join(meshPaths(storeRoot).presenceDir, `${liveSessionId}.json`);
  if (!existsSync(filePath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  if (raw.trim() === "") {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  const parsedJson = safeJsonParse(raw);
  if (parsedJson === undefined) {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  const result = presenceRecordSchema.safeParse(parsedJson);
  if (!result.success) {
    quarantineFileSync(filePath, storeRoot);
    return undefined;
  }
  const rec = result.data;
  if (rec.repositoryFamilyKey !== undefined) {
    return { workspaceKey: rec.workspaceKey, repositoryFamilyKey: rec.repositoryFamilyKey };
  }
  return { workspaceKey: rec.workspaceKey };
}

export function claimPaths(
  storeRoot: string,
  input: { liveSessionId: string; paths: string[]; intent?: string },
): ClaimRecord {
  if (!SAFE_SEGMENT.test(input.liveSessionId)) {
    throw new Error(`unsafe liveSessionId: ${input.liveSessionId}`);
  }
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > 64) {
    throw new Error("paths must be non-empty array of 1..64 entries");
  }
  for (const p of input.paths) {
    if (typeof p !== "string" || p.length < 1 || p.length > 1_024) {
      throw new Error(`invalid path length: ${p}`);
    }
    if (!isRepoRelative(p)) {
      throw new Error(`scope paths must be repo-relative: ${p}`);
    }
  }
  if (input.intent !== undefined && typeof input.intent !== "string") {
    throw new Error("intent must be string");
  }
  if (input.intent !== undefined && input.intent.length > 10_000) {
    // allow long intent before redact, will be truncated after redact; but guard absurdly large input bounded
    throw new Error("intent too long");
  }

  const scope = loadPresenceForScope(storeRoot, input.liveSessionId);
  if (scope === undefined) {
    throw new Error(`unknown liveSessionId: ${input.liveSessionId}`);
  }

  let redactedIntent: string | undefined;
  if (input.intent !== undefined) {
    const { redacted } = redact(input.intent);
    let out = redacted;
    if (out.length > 256) out = out.slice(0, 256);
    redactedIntent = out;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
  const claimId = randomUUID();
  if (!SAFE_SEGMENT.test(claimId)) {
    // randomUUID always passes, but guard
    throw new Error(`generated claimId invalid: ${claimId}`);
  }

  const record: ClaimRecord = {
    claimId,
    liveSessionId: input.liveSessionId,
    workspaceKey: scope.workspaceKey as string,
    ...(scope.repositoryFamilyKey !== undefined
      ? { repositoryFamilyKey: scope.repositoryFamilyKey }
      : {}),
    paths: [...input.paths],
    ...(redactedIntent !== undefined ? { intent: redactedIntent } : {}),
    createdAt: nowIso,
    refreshedAt: nowIso,
    expiresAt,
  };

  const parsed = claimRecordSchema.parse(record) as ClaimRecord;

  const { claimsDir } = meshPaths(storeRoot);
  try {
    mkdirSync(claimsDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(claimsDir, 0o700);
    } catch {}
  } catch {}

  const filePath = join(claimsDir, `${parsed.claimId}.json`);
  atomicWriteFileSync(filePath, `${JSON.stringify(parsed)}\n`);

  return parsed;
}

export function checkConflicts(
  storeRoot: string,
  liveSessionId: string,
  paths: string[],
): ClaimRecord[] {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const { claimsDir } = meshPaths(storeRoot);
  if (!existsSync(claimsDir)) return [];

  const nowMs = Date.now();

  let files: string[];
  try {
    files = readdirSync(claimsDir);
  } catch {
    return [];
  }

  let liveSet: Set<string>;
  try {
    const peers = listPeers(storeRoot, { all: true });
    liveSet = new Set(peers.map((p) => p.liveSessionId));
  } catch {
    liveSet = new Set();
  }

  const callerScope = loadPresenceForScope(storeRoot, liveSessionId);

  const conflicts: ClaimRecord[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(claimsDir, file);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (raw.trim() === "") {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    const parsedJson = safeJsonParse(raw);
    if (parsedJson === undefined) {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    const result = claimRecordSchema.safeParse(parsedJson);
    if (!result.success) {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    const rec = result.data as ClaimRecord;

    const expiresMs = Date.parse(rec.expiresAt);
    if (Number.isNaN(expiresMs) || expiresMs <= nowMs) continue;
    if (rec.liveSessionId === liveSessionId) continue;
    if (!liveSet.has(rec.liveSessionId)) continue;

    if (callerScope && (callerScope.workspaceKey || callerScope.repositoryFamilyKey)) {
      if (!sameScope(rec, callerScope)) continue;
    }

    let overlap = false;
    for (const claimPath of rec.paths) {
      for (const qPath of paths) {
        if (pathOverlaps(claimPath, qPath)) {
          overlap = true;
          break;
        }
      }
      if (overlap) break;
    }
    if (!overlap) continue;

    conflicts.push(rec);
  }

  conflicts.sort((a, b) => a.claimId.localeCompare(b.claimId));
  return conflicts;
}

export function releaseClaim(storeRoot: string, claimId: string): boolean {
  if (typeof claimId !== "string" || claimId.length === 0) return false;
  if (!SAFE_SEGMENT.test(claimId)) return false;
  if (claimId.includes("/") || claimId.includes("\\") || claimId.includes("\0")) return false;
  const { claimsDir } = meshPaths(storeRoot);
  const filePath = join(claimsDir, `${claimId}.json`);
  if (!existsSync(filePath)) return false;
  try {
    rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}
