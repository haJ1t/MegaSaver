import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { meshPaths } from "../paths.js";
import { atomicWriteFileSync, safeJsonParse } from "../store.js";
import { type BoardFact, SAFE_SEGMENT, boardFactSchema } from "../types.js";
import { readBoardFacts } from "./store.js";

export const BOARD_INJECT_MAX_TOKENS = 500;
export const BOARD_DELTA_CHECK_INTERVAL_MS = 30_000;

function boardCursorDir(storeRoot: string): string {
  return join(storeRoot, "mesh", "board-cursor");
}

function boardCursorPath(storeRoot: string, liveSessionId: string): string {
  if (!SAFE_SEGMENT.test(liveSessionId)) {
    throw new Error(`unsafe liveSessionId: ${liveSessionId}`);
  }
  return join(boardCursorDir(storeRoot), `${liveSessionId}.json`);
}

function isExpired(fact: BoardFact, nowMs: number): boolean {
  if (fact.expiresAt === null) return false;
  const exp = Date.parse(fact.expiresAt);
  if (Number.isNaN(exp)) return false;
  return exp <= nowMs;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function loadPresenceScope(
  storeRoot: string,
  liveSessionId: string,
): { workspaceKey?: string; repositoryFamilyKey?: string } | undefined {
  if (!SAFE_SEGMENT.test(liveSessionId)) return undefined;
  const filePath = join(meshPaths(storeRoot).presenceDir, `${liveSessionId}.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = safeJsonParse(raw) as
      | { workspaceKey?: string; repositoryFamilyKey?: string }
      | undefined;
    if (!parsed || typeof parsed.workspaceKey !== "string") return undefined;
    if (typeof parsed.repositoryFamilyKey === "string") {
      return {
        workspaceKey: parsed.workspaceKey,
        repositoryFamilyKey: parsed.repositoryFamilyKey,
      };
    }
    return { workspaceKey: parsed.workspaceKey };
  } catch {
    return undefined;
  }
}

function sameRepo(
  factRepoKey: string,
  scope: { workspaceKey?: string; repositoryFamilyKey?: string },
): boolean {
  if (scope.repositoryFamilyKey !== undefined && factRepoKey === scope.repositoryFamilyKey)
    return true;
  if (scope.workspaceKey !== undefined && factRepoKey === scope.workspaceKey) return true;
  // fallback: if factRepoKey matches either, else not same
  return false;
}

function filterFactsForInjection(
  storeRoot: string,
  liveSessionId: string,
  nowMs: number,
): BoardFact[] {
  const all = readBoardFacts(storeRoot, {});
  const scope = loadPresenceScope(storeRoot, liveSessionId);
  const filtered: BoardFact[] = [];
  for (const f of all) {
    if (f.status !== "active") continue;
    if (f.confidence !== "high") continue;
    if (isExpired(f, nowMs)) continue;
    // sameScope repo filtering: if we have presence scope, require match
    if (scope !== undefined) {
      // If we couldn't determine scope? Already have scope, check repo match.
      // If fact repoKey is neither workspaceKey nor familyKey, skip.
      // This implements sameScope filtering; when presence has familyKey, it must match familyKey.
      // When both have familyKey, match familyKey; else workspaceKey.
      // Simplify: require exact match with either.
      if (!sameRepo(f.scope.repoKey, scope)) continue;
    }
    filtered.push(f);
  }
  // sort by createdAt desc? For injection, newest first might be more relevant.
  // We'll sort by createdAt asc to be deterministic and cap oldest first? Choose newest first to surface recent.
  filtered.sort((a, b) => {
    const da = Date.parse(a.createdAt);
    const db = Date.parse(b.createdAt);
    if (da !== db) return db - da; // newest first
    return a.id.localeCompare(b.id);
  });
  return filtered;
}

function readCursor(storeRoot: string, liveSessionId: string): { lastAt: string } | undefined {
  if (!SAFE_SEGMENT.test(liveSessionId)) return undefined;
  const p = boardCursorPath(storeRoot, liveSessionId);
  if (!existsSync(p)) return undefined;
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = safeJsonParse(raw) as { lastAt?: unknown } | undefined;
    if (parsed && typeof parsed.lastAt === "string" && !Number.isNaN(Date.parse(parsed.lastAt))) {
      return { lastAt: parsed.lastAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(storeRoot: string, liveSessionId: string, nowIso: string): void {
  if (!SAFE_SEGMENT.test(liveSessionId)) return;
  const dir = boardCursorDir(storeRoot);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {}
  } catch {}
  const p = boardCursorPath(storeRoot, liveSessionId);
  try {
    atomicWriteFileSync(p, `${JSON.stringify({ lastAt: nowIso })}\n`);
  } catch {}
}

export function selectFactsForInjection(
  storeRoot: string,
  liveSessionId: string,
): { facts: BoardFact[]; tokens: number } {
  if (!SAFE_SEGMENT.test(liveSessionId)) return { facts: [], tokens: 0 };
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // debounce check
  const cursor = readCursor(storeRoot, liveSessionId);
  if (cursor !== undefined) {
    const lastMs = Date.parse(cursor.lastAt);
    if (!Number.isNaN(lastMs) && nowMs - lastMs < BOARD_DELTA_CHECK_INTERVAL_MS) {
      return { facts: [], tokens: 0 };
    }
  }

  const candidates = filterFactsForInjection(storeRoot, liveSessionId, nowMs);
  const facts: BoardFact[] = [];
  let tokens = 0;
  for (const f of candidates) {
    const est = estimateTokens(f.text);
    if (tokens + est > BOARD_INJECT_MAX_TOKENS) break;
    facts.push(f);
    tokens += est;
  }

  // update cursor even if facts empty? Update to debounce future calls
  writeCursor(storeRoot, liveSessionId, nowIso);

  return { facts, tokens };
}

// Non-debounced variant for SessionStart digest: always returns up to 500 tokens ignoring cursor debounce
export function selectBoardDigest(
  storeRoot: string,
  liveSessionId: string,
): { facts: BoardFact[]; tokens: number } {
  if (!SAFE_SEGMENT.test(liveSessionId)) return { facts: [], tokens: 0 };
  const nowMs = Date.now();
  const candidates = filterFactsForInjection(storeRoot, liveSessionId, nowMs);
  const facts: BoardFact[] = [];
  let tokens = 0;
  for (const f of candidates) {
    const est = estimateTokens(f.text);
    if (tokens + est > BOARD_INJECT_MAX_TOKENS) break;
    facts.push(f);
    tokens += est;
  }
  // also update cursor for digest so subsequent delta respects debounce
  writeCursor(storeRoot, liveSessionId, new Date(nowMs).toISOString());
  return { facts, tokens };
}

export function formatBoardFacts(facts: BoardFact[]): string {
  if (facts.length === 0) return "";
  const lines: string[] = [];
  lines.push(`[Board — ${facts.length} fact(s)]`);
  for (const f of facts) {
    const paths = f.scope.paths ? ` @ ${f.scope.paths.join(",")}` : "";
    lines.push(`· [${f.topic}] ${f.text} (confidence:${f.confidence}${paths})`);
  }
  return lines.join("\n");
}
