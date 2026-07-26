import {
  type ChangedFrom,
  type CoreRegistry,
  CoreRegistryError,
  type MemoryEntry,
  type VerificationBadge,
  changedFromFor,
  isRecallable,
  verificationBadgeFor,
} from "@megasaver/core";
import { rankProjectMemories } from "@megasaver/memory-recall";
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { type ContradictedDisclosure, spotCheckHits } from "./code-truth-check.js";

export type EmbedFn = (texts: readonly string[]) => Promise<Float32Array[]>;
export type GetRelevantMemoriesEnv = {
  registry: CoreRegistry;
  storeRoot?: string;
  embedFn?: EmbedFn;
  // Pro is resolved CLI-side (mega mcp serve) and threaded through ServerDeps;
  // the spot-check (i6 §8.4) is a no-op when absent/false. now/monotonicNow/
  // execGit are injectable for deterministic spot-check tests.
  isPro?: boolean;
  now?: () => string;
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
};

export const getRelevantMemoriesInputSchema = z
  .object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    limit: z.number().int().positive().optional(),
    // Bi-temporal time-travel: rank memories valid AS OF this instant.
    // Absent ⇒ now ⇒ currently-valid only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type GetRelevantMemoriesResult = {
  memory: readonly (MemoryEntry & {
    changedFrom?: ChangedFrom;
    verification: VerificationBadge;
  })[];
  hybrid?: Awaited<ReturnType<typeof rankProjectMemories>>["hybrid"];
  contradictedByCode?: ContradictedDisclosure[];
};

async function hybridMemoryRanking(
  env: GetRelevantMemoriesEnv,
  projectId: ProjectId,
  task: string,
  limit: number | undefined,
  asOf: string,
): Promise<Awaited<ReturnType<typeof rankProjectMemories>> | null> {
  if (env.storeRoot === undefined) return null;
  const result = await rankProjectMemories({
    projectId,
    entries: env.registry.listMemoryEntries(projectId),
    task,
    storeRoot: env.storeRoot,
    query: { text: task, asOf, ...(limit === undefined ? {} : { limit }) },
    ...(env.embedFn === undefined ? {} : { embed: env.embedFn }),
  });
  return result;
}

// changedFrom enrichment (response-only, never persisted): a hit that
// supersedes a CLOSED predecessor carries { title, closedAt, reason } so the
// agent sees what changed. Reopened predecessors (validTo null) carry nothing.
function withChangedFrom(
  registry: CoreRegistry,
  hits: readonly MemoryEntry[],
): (MemoryEntry & { changedFrom?: ChangedFrom })[] {
  const byId = new Map<string, MemoryEntry>();
  for (const hit of hits) {
    if (hit.supersedesId === undefined || byId.has(hit.supersedesId)) continue;
    const predecessor = registry.getMemoryEntry(hit.supersedesId);
    if (predecessor !== null) byId.set(hit.supersedesId, predecessor);
  }
  return hits.map((hit) => {
    const changedFrom = changedFromFor(hit, byId);
    return { ...hit, ...(changedFrom === undefined ? {} : { changedFrom }) };
  });
}

// Free-text task → top-N relevant memories. Semantic (cosine over the memory
// sidecar) when available, gracefully falling back to BM25 over title+content+
// keywords (the same offline ranker as `mega memory search`).
export async function handleGetRelevantMemories(
  env: GetRelevantMemoriesEnv,
  rawArgs: unknown,
): Promise<GetRelevantMemoriesResult> {
  const parsed = getRelevantMemoriesInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { projectId, task, limit, asOf } = parsed.data;
  const at = asOf ?? new Date().toISOString();

  try {
    const hybrid = await hybridMemoryRanking(env, projectId as ProjectId, task, limit, at);
    const ranked =
      hybrid?.memory ??
      env.registry.searchMemoryEntries(projectId as ProjectId, {
        text: task,
        asOf: at,
        ...(limit !== undefined ? { limit } : {}),
      });
    // Pre-recall spot-check (i6 §8.4): Pro-only, fail-open, ~50ms budget.
    // Contradicted hits are EXCLUDED from the response and disclosed in
    // contradictedByCode; the stale/validTo flip persists inline inside THIS
    // try/catch (architect M3 — the bridge has no post-response lifecycle).
    const project = env.registry.getProject(projectId as ProjectId);
    const check =
      project !== null
        ? await spotCheckHits(
            {
              registry: env.registry,
              isPro: env.isPro ?? false,
              now: env.now ?? (() => new Date().toISOString()),
              ...(env.monotonicNow !== undefined ? { monotonicNow: env.monotonicNow } : {}),
              ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
              ...(env.storeRoot !== undefined ? { ledger: { storeRoot: env.storeRoot } } : {}),
            },
            project.rootPath,
            ranked,
          )
        : { hits: [...ranked], contradictedByCode: [] as ContradictedDisclosure[] };
    const memory = withChangedFrom(env.registry, check.hits).map((m) => ({
      ...m,
      verification: verificationBadgeFor(m),
    }));
    return {
      memory,
      ...(hybrid === null ? {} : { hybrid: hybrid.hybrid }),
      ...(check.contradictedByCode.length > 0
        ? { contradictedByCode: check.contradictedByCode }
        : {}),
    };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
