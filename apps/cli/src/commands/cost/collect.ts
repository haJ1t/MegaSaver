import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type CostSessionMeta,
  type SavingsReceipt,
  type SpendReceipt,
  createJsonDirectoryCoreRegistry,
} from "@megasaver/core";
import type { ProxyUsageEvent } from "@megasaver/llm-proxy";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";

const EVENTS_SUFFIX = ".events.jsonl";
const uuidSchema = z.string().uuid();

// Loose per-line shape (runAuditUsage precedent: resilient to schema drift).
// deltaTokens is trusted as the writer's measured-pair product (deltaTokensOf
// semantics) — never reconstructed from bytes here.
const looseEventSchema = z.object({
  createdAt: z.string(),
  deltaTokens: z.number().int().optional(),
});

export interface SavingsEventFile {
  dir: string;
  file: string;
}

// Walk stats/ under the mandatory two-layout discriminator: overlay dirs are
// 16-hex workspaceKeys, registry dirs are project UUIDs; every other entry
// (budget.json, task-kickoff-sessions, …) is skipped, never read. Session
// event files have UUID basenames, which excludes the sibling ledgers
// (guard/handoff/warm-start/code-truth .events.jsonl) structurally.
export function listSavingsEventFiles(storeRoot: string): SavingsEventFile[] {
  const statsDir = join(storeRoot, "stats");
  let names: string[];
  try {
    names = readdirSync(statsDir);
  } catch {
    return [];
  }
  const found: SavingsEventFile[] = [];
  for (const dir of names) {
    const isOverlay = workspaceKeySchema.safeParse(dir).success;
    const isRegistry = !isOverlay && uuidSchema.safeParse(dir).success;
    if (!isOverlay && !isRegistry) continue;
    let files: string[];
    try {
      files = readdirSync(join(statsDir, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(EVENTS_SUFFIX)) continue;
      const base = file.slice(0, -EVENTS_SUFFIX.length);
      if (!uuidSchema.safeParse(base).success) continue;
      found.push({ dir, file });
    }
  }
  return found;
}

function readEventLines(path: string, project: string, session: string): SavingsReceipt[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const receipts: SavingsReceipt[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = looseEventSchema.safeParse(parsed);
    if (!row.success) continue;
    receipts.push({
      createdAt: row.data.createdAt,
      project,
      session,
      ...(row.data.deltaTokens !== undefined ? { deltaTokens: row.data.deltaTokens } : {}),
    });
  }
  return receipts;
}

export function collectSavingsReceipts(storeRoot: string): SavingsReceipt[] {
  const receipts: SavingsReceipt[] = [];
  for (const { dir, file } of listSavingsEventFiles(storeRoot)) {
    const session = file.slice(0, -EVENTS_SUFFIX.length);
    receipts.push(...readEventLines(join(storeRoot, "stats", dir, file), dir, session));
  }
  return receipts;
}

// Locked PresenceRecord contract (session-mesh plan, build-order 1):
// mesh/presence/<liveSessionId>.json carries { liveSessionId, workspaceKey,
// agent, cwd, branch?, taskLabel?, status, registeredAt, lastSeenAt }.
// Parse only the three fields the ledger needs, non-strict, so mesh field
// additions never break this reader. Absent dir -> no task labels.
const meshPresenceSchema = z.object({
  liveSessionId: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
  taskLabel: z.string().min(1).optional(),
});

export function collectSessionMeta(storeRoot: string): Map<string, CostSessionMeta> {
  const meta = new Map<string, CostSessionMeta>();
  try {
    const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });
    for (const project of registry.listProjects()) {
      for (const session of registry.listSessions(project.id)) {
        meta.set(session.id, { agent: session.agentId });
      }
    }
  } catch {
    // Uninitialized store: the agent facet degrades to UNKNOWN.
  }
  const presenceDir = join(storeRoot, "mesh", "presence");
  let files: string[];
  try {
    files = readdirSync(presenceDir);
  } catch {
    return meta;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(presenceDir, file), "utf8"));
    } catch {
      continue;
    }
    const presence = meshPresenceSchema.safeParse(parsed);
    if (!presence.success) continue;
    const sessionId = presence.data.liveSessionId ?? file.slice(0, -".json".length);
    const existing = meta.get(sessionId);
    // Registry agent wins: it is a validated agentIdSchema enum, mesh agent
    // is free-form. Task labels only exist on mesh presence. Registry session
    // ids and transcript live session ids are distinct id spaces: a registry
    // row is enriched only when its id happens to equal the live session id;
    // otherwise it keeps agent-only meta (task facet degrades to UNKNOWN).
    const agent = existing?.agent ?? presence.data.agent;
    meta.set(sessionId, {
      ...(agent !== undefined ? { agent } : {}),
      ...(presence.data.taskLabel !== undefined ? { task: presence.data.taskLabel } : {}),
    });
  }
  return meta;
}

export function toSpendReceipts(events: readonly ProxyUsageEvent[]): SpendReceipt[] {
  return events.map((e) => ({
    ts: e.ts,
    model: e.model,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    cacheReadTokens: e.cacheReadTokens,
    cacheCreationTokens: e.cacheCreationTokens,
    ...(e.workspaceKey !== undefined ? { workspaceKey: e.workspaceKey } : {}),
  }));
}

// ISO 8601 datetime/date, or a relative window: <N>d (days), <N>h (hours).
// Bounded quantifier, anchored — not in the unbounded-run ReDoS class.
export function parseSince(raw: string, nowMs: number): number | undefined {
  const rel = /^(\d{1,4})([dh])$/.exec(raw.trim());
  if (rel?.[1] !== undefined && rel[2] !== undefined) {
    const n = Number.parseInt(rel[1], 10);
    return nowMs - n * (rel[2] === "d" ? 86_400_000 : 3_600_000);
  }
  const abs = Date.parse(raw);
  return Number.isFinite(abs) ? abs : undefined;
}
