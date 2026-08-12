import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { meshPaths } from "./paths.js";
import {
  DEAD_AFTER_MS,
  HEARTBEAT_DEBOUNCE_MS,
  atomicWriteFileSync,
  quarantineFileSync,
  safeJsonParse,
} from "./store.js";
import { type PresenceRecord, SAFE_SEGMENT, presenceRecordSchema } from "./types.js";

function presenceFilePath(storeRoot: string, liveSessionId: string): string {
  return join(meshPaths(storeRoot).presenceDir, `${liveSessionId}.json`);
}

function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}

export function registerSession(storeRoot: string, rec: PresenceRecord): void {
  const parsed = presenceRecordSchema.parse(rec);
  if (!isSafeSegment(parsed.liveSessionId)) {
    throw new Error(`unsafe path segment: ${parsed.liveSessionId}`);
  }
  const { presenceDir } = meshPaths(storeRoot);
  mkdirSync(presenceDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(presenceDir, 0o700);
  } catch {}
  const filePath = presenceFilePath(storeRoot, parsed.liveSessionId);
  atomicWriteFileSync(filePath, `${JSON.stringify(parsed)}\n`);
}

export function heartbeat(
  storeRoot: string,
  liveSessionId: string,
  patch?: Partial<Pick<PresenceRecord, "status" | "task">>,
): void {
  try {
    if (!isSafeSegment(liveSessionId)) return;
    const filePath = presenceFilePath(storeRoot, liveSessionId);
    if (!existsSync(filePath)) return;

    const hasPatch =
      patch !== undefined && (patch.status !== undefined || patch.task !== undefined);

    if (!hasPatch) {
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (Date.now() - mtime < HEARTBEAT_DEBOUNCE_MS) return;
      } catch {
        return;
      }
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      return;
    }
    const parsed = safeJsonParse(raw);
    if (parsed === undefined) {
      quarantineFileSync(filePath, storeRoot);
      return;
    }
    const result = presenceRecordSchema.safeParse(parsed);
    if (!result.success) {
      quarantineFileSync(filePath, storeRoot);
      return;
    }
    const prior = result.data;
    const merged: Record<string, unknown> = {
      ...prior,
      ...(patch?.status !== undefined ? { status: patch.status } : {}),
      ...(patch?.task !== undefined ? { task: patch.task } : {}),
      lastSeenAt: new Date().toISOString(),
    };
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) delete merged[key];
    }
    const validated = presenceRecordSchema.parse(merged) as PresenceRecord;
    atomicWriteFileSync(filePath, `${JSON.stringify(validated)}\n`);
  } catch {}
}

function sameScope(
  record: PresenceRecord,
  filter: { workspaceKey?: string; repositoryFamilyKey?: string; all?: boolean },
): boolean {
  if (filter.all) return true;
  if (filter.workspaceKey === undefined && filter.repositoryFamilyKey === undefined) return true;
  const filterHasFamily = filter.repositoryFamilyKey !== undefined;
  const recordHasFamily = record.repositoryFamilyKey !== undefined;
  if (filterHasFamily && recordHasFamily) {
    return record.repositoryFamilyKey === filter.repositoryFamilyKey;
  }
  // fallback to workspaceKey equality
  if (filter.workspaceKey === undefined) return false;
  return record.workspaceKey === filter.workspaceKey;
}

export function listPeers(
  storeRoot: string,
  filter: { workspaceKey?: string; repositoryFamilyKey?: string; all?: boolean },
): PresenceRecord[] {
  const { presenceDir } = meshPaths(storeRoot);
  if (!existsSync(presenceDir)) return [];
  const nowMs = Date.now();
  const peers: PresenceRecord[] = [];
  let files: string[];
  try {
    files = readdirSync(presenceDir);
  } catch {
    return [];
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(presenceDir, file);
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
    const parsed = safeJsonParse(raw);
    if (parsed === undefined) {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    const result = presenceRecordSchema.safeParse(parsed);
    if (!result.success) {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    const rec = result.data as PresenceRecord;
    // staleness: future skew → live (negative age → 0)
    let age = nowMs - Date.parse(rec.lastSeenAt);
    if (Number.isNaN(age)) age = 0;
    if (age < 0) age = 0;
    if (age > DEAD_AFTER_MS) continue;

    if (!sameScope(rec, filter)) continue;

    peers.push(rec);
  }
  peers.sort((a, b) => a.liveSessionId.localeCompare(b.liveSessionId));
  return peers;
}
