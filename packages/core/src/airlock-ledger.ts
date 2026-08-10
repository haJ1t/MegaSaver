import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { withFileLock } from "@megasaver/shared/node";
import { isSafeKeySegment } from "./overlay-key.js";

export interface AirlockNegativeRule {
  ruleId: string;
  sessionId: string;
  toolName: string;
  forbiddenPattern: string;
  reason: string;
  createdAt: string;
  ttlSeconds: number;
}

const IS_WIN32 = process.platform === "win32";

function ledgerPath(storeRoot: string, sessionId: string): string {
  if (!isSafeKeySegment(sessionId)) throw new Error(`unsafe segment: ${sessionId}`);
  return join(storeRoot, "airlock", `${sessionId}.jsonl`);
}

function isExpired(rule: AirlockNegativeRule, now: number): boolean {
  const t = Date.parse(rule.createdAt);
  if (Number.isNaN(t)) return true;
  return t + rule.ttlSeconds * 1000 < now;
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);
  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new Error(`store path is symlink: ${parentDir}`);
    }
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {}
    throw error;
  }
}

export async function appendRule(storeRoot: string, rule: AirlockNegativeRule): Promise<void> {
  if (!isSafeKeySegment(rule.sessionId)) throw new Error("unsafe segment");
  const path = ledgerPath(storeRoot, rule.sessionId);
  mkdirSync(join(storeRoot, "airlock"), { recursive: true });
  withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    let existing = "";
    try {
      existing = readFileSync(path, "utf8");
    } catch {}
    const next = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + JSON.stringify(rule) + "\n";
    atomicWriteFileSync(path, next);
  });
}

export async function readRules(
  storeRoot: string,
  sessionId: string,
  now?: number,
): Promise<AirlockNegativeRule[]> {
  const at = now ?? Date.now();
  const path = ledgerPath(storeRoot, sessionId);
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: AirlockNegativeRule[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as AirlockNegativeRule;
      if (!isExpired(r, at)) out.push(r);
    } catch {}
  }
  return out;
}

export async function pruneExpired(
  storeRoot: string,
  sessionId: string,
  now?: number,
): Promise<number> {
  const at = now ?? Date.now();
  const path = ledgerPath(storeRoot, sessionId);
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return 0;
  }
  const all: AirlockNegativeRule[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      all.push(JSON.parse(t) as AirlockNegativeRule);
    } catch {}
  }
  const kept = all.filter((r) => !isExpired(r, at));
  const removed = all.length - kept.length;
  if (removed > 0) {
    withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
      atomicWriteFileSync(path, kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""));
    });
  }
  return removed;
}

export async function clearRules(storeRoot: string, sessionId: string): Promise<void> {
  const path = ledgerPath(storeRoot, sessionId);
  withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs: 5000 }, () => {
    try {
      unlinkSync(path);
    } catch {}
  });
}
