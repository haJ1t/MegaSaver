import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import { meshPaths } from "../paths.js";
import { atomicWriteFileSync, quarantineFileSync, safeJsonParse } from "../store.js";
import { type BoardFact, SAFE_SEGMENT, boardFactSchema } from "../types.js";
import { normalizeTopic } from "./schema.js";

const SAFE_SEGMENT_RE = SAFE_SEGMENT;

function isRepoRelative(p: string): boolean {
  const trimmed = p.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  return true;
}

function getAgentForSession(storeRoot: string, liveSessionId: string): string {
  try {
    const filePath = join(meshPaths(storeRoot).presenceDir, `${liveSessionId}.json`);
    if (!existsSync(filePath)) return "unknown";
    const raw = readFileSync(filePath, "utf8");
    const parsed = safeJsonParse(raw) as { agent?: unknown } | undefined;
    if (parsed && typeof parsed.agent === "string" && parsed.agent.trim().length > 0) {
      return parsed.agent.trim();
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function boardFilePath(storeRoot: string, factId: string): string {
  return join(meshPaths(storeRoot).boardDir, `${factId}.json`);
}

function readAllBoardFactsInternal(storeRoot: string): BoardFact[] {
  const { boardDir } = meshPaths(storeRoot);
  if (!existsSync(boardDir)) return [];
  let files: string[];
  try {
    files = readdirSync(boardDir);
  } catch {
    return [];
  }
  const facts: BoardFact[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(boardDir, file);
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
    const result = boardFactSchema.safeParse(parsedJson);
    if (!result.success) {
      quarantineFileSync(filePath, storeRoot);
      continue;
    }
    facts.push(result.data);
  }
  return facts;
}

export function postFact(
  storeRoot: string,
  input: {
    text: string;
    topic: string;
    confidence: "low" | "medium" | "high";
    scope: { repo: string; paths?: string[] };
    expiresAt: string | null;
    liveSessionId: string;
  },
): BoardFact {
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("text must be non-empty");
  }
  if (typeof input.topic !== "string" || input.topic.trim().length === 0) {
    throw new Error("topic must be non-empty");
  }
  if (!["low", "medium", "high"].includes(input.confidence)) {
    throw new Error(`invalid confidence: ${input.confidence}`);
  }
  if (typeof input.scope !== "object" || input.scope === null) {
    throw new Error("scope must be object");
  }
  const repo = input.scope.repo;
  if (typeof repo !== "string" || repo.trim().length === 0) {
    throw new Error("scope.repo must be non-empty");
  }
  if (input.scope.paths !== undefined) {
    if (!Array.isArray(input.scope.paths)) throw new Error("scope.paths must be array");
    for (const p of input.scope.paths) {
      if (typeof p !== "string" || p.length < 1 || p.length > 1024) {
        throw new Error(`invalid path length: ${p}`);
      }
      if (!isRepoRelative(p)) {
        throw new Error(`scope paths must be repo-relative: ${p}`);
      }
    }
  }
  if (input.expiresAt !== null) {
    if (typeof input.expiresAt !== "string" || Number.isNaN(Date.parse(input.expiresAt))) {
      throw new Error(`invalid expiresAt: ${input.expiresAt}`);
    }
  }
  if (typeof input.liveSessionId !== "string" || input.liveSessionId.trim().length === 0) {
    throw new Error("liveSessionId must be non-empty");
  }
  if (!SAFE_SEGMENT_RE.test(input.liveSessionId)) {
    // allow but guard path traversal; if not safe, still allow fact but will not be used for cursor etc?
    // For board we allow any non-empty liveSessionId but guard file writes via factId only.
  }

  const normalized = normalizeTopic(input.topic);
  const { redacted } = redact(input.text);
  let redactedText = redacted;
  // schema requires trim min1; ensure not empty after redact?
  if (redactedText.trim().length === 0) redactedText = "[redacted]";

  const factId = randomUUID().toLowerCase();
  const nowIso = new Date().toISOString();
  const agent = getAgentForSession(storeRoot, input.liveSessionId);

  const scopePaths = input.scope.paths !== undefined ? [...input.scope.paths] : undefined;

  const newFact: BoardFact = {
    id: factId as unknown as BoardFact["id"],
    topic: normalized,
    text: redactedText,
    source: { liveSessionId: input.liveSessionId, agent },
    createdAt: nowIso,
    confidence: input.confidence,
    scope: {
      repoKey: repo.trim(),
      ...(scopePaths !== undefined ? { paths: scopePaths } : {}),
    },
    expiresAt: input.expiresAt,
    status: "active",
    disputedWith: [],
  };

  // Validate against schema before disputed handling
  const parsedNew = boardFactSchema.parse(newFact) as BoardFact;

  const { boardDir } = meshPaths(storeRoot);
  try {
    mkdirSync(boardDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(boardDir, 0o700);
    } catch {}
  } catch {}

  // Scan existing facts for disputed / supersede handling
  const existingFacts = readAllBoardFactsInternal(storeRoot);
  const nowMs = Date.now();
  let newStatus: BoardFact["status"] = "active";
  const newDisputedWith: string[] = [];

  for (const existing of existingFacts) {
    // skip expired
    if (existing.expiresAt !== null) {
      const expMs = Date.parse(existing.expiresAt);
      if (!Number.isNaN(expMs) && expMs <= nowMs) continue;
    }
    if (existing.status === "resolved") continue;
    if (existing.scope.repoKey !== parsedNew.scope.repoKey) continue;
    const existingNorm = normalizeTopic(existing.topic);
    const newNorm = normalizeTopic(parsedNew.topic);
    if (existingNorm !== newNorm) continue;

    if (existing.source.liveSessionId === parsedNew.source.liveSessionId) {
      // same-session supersedes: old becomes resolved
      const resolved: BoardFact = {
        ...existing,
        status: "resolved",
      };
      const validated = boardFactSchema.parse(resolved) as BoardFact;
      const fp = boardFilePath(storeRoot, existing.id);
      try {
        atomicWriteFileSync(fp, `${JSON.stringify(validated)}\n`);
      } catch {}
    } else {
      // cross-session dispute: mark both disputed
      newStatus = "disputed";
      if (!newDisputedWith.includes(existing.id)) newDisputedWith.push(existing.id);

      const disputedExisting: BoardFact = {
        ...existing,
        status: "disputed",
        disputedWith: Array.from(new Set([...existing.disputedWith, parsedNew.id])),
      };
      const validated = boardFactSchema.parse(disputedExisting) as BoardFact;
      const fp = boardFilePath(storeRoot, existing.id);
      try {
        atomicWriteFileSync(fp, `${JSON.stringify(validated)}\n`);
      } catch {}
    }
  }

  const finalFact: BoardFact = {
    ...parsedNew,
    status: newStatus,
    disputedWith: newDisputedWith as BoardFact["disputedWith"],
  };
  const validatedFinal = boardFactSchema.parse(finalFact) as BoardFact;
  const newPath = boardFilePath(storeRoot, validatedFinal.id);
  atomicWriteFileSync(newPath, `${JSON.stringify(validatedFinal)}\n`);
  return validatedFinal;
}

export function readBoardFacts(
  storeRoot: string,
  filter: { repo?: string; topic?: string; status?: string },
): BoardFact[] {
  const all = readAllBoardFactsInternal(storeRoot);
  let out = all;
  if (filter.repo !== undefined) {
    out = out.filter((f) => f.scope.repoKey === filter.repo);
  }
  if (filter.topic !== undefined) {
    const norm = normalizeTopic(filter.topic);
    out = out.filter((f) => normalizeTopic(f.topic) === norm);
  }
  if (filter.status !== undefined) {
    out = out.filter((f) => f.status === filter.status);
  }
  // sort by createdAt asc for determinism
  out.sort((a, b) => {
    const da = Date.parse(a.createdAt);
    const db = Date.parse(b.createdAt);
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
  return out;
}

export function resolveFact(storeRoot: string, factId: string, note?: string): void {
  if (typeof factId !== "string" || factId.trim().length === 0) {
    throw new Error("factId must be non-empty");
  }
  if (factId.includes("/") || factId.includes("\\") || factId.includes("\0")) {
    throw new Error("invalid factId");
  }
  const filePath = boardFilePath(storeRoot, factId);
  if (!existsSync(filePath)) {
    throw new Error(`board fact not found: ${factId}`);
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`board fact not found: ${factId}`);
  }
  if (raw.trim() === "") {
    quarantineFileSync(filePath, storeRoot);
    throw new Error(`board fact not found: ${factId}`);
  }
  const parsedJson = safeJsonParse(raw);
  if (parsedJson === undefined) {
    quarantineFileSync(filePath, storeRoot);
    throw new Error(`board fact not found: ${factId}`);
  }
  const result = boardFactSchema.safeParse(parsedJson);
  if (!result.success) {
    quarantineFileSync(filePath, storeRoot);
    throw new Error(`board fact not found: ${factId}`);
  }
  const fact = result.data as BoardFact;
  const nowIso = new Date().toISOString();
  const resolved: BoardFact = {
    ...fact,
    status: "resolved",
    resolution: {
      byLiveSessionId: "cli",
      at: nowIso,
      ...(note !== undefined ? { note } : {}),
    },
  };
  const validated = boardFactSchema.parse(resolved) as BoardFact;
  atomicWriteFileSync(filePath, `${JSON.stringify(validated)}\n`);
}
