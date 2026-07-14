import { type ChunkSetSummary, listChunkSets } from "@megasaver/content-store";
import {
  type ChangedFrom,
  type CoreRegistry,
  type MemoryEntry,
  changedFromFor,
  isRecallable,
} from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import {
  type ContradictedDisclosure,
  type VerificationBadge,
  spotCheckHits,
  verificationBadgeFor,
} from "./code-truth-check.js";
import { forwardOrFallback } from "./forward.js";

export type RecallToolEnv = {
  registry: CoreRegistry;
  storeRoot: string;
  // Pro is resolved CLI-side and threaded via ServerDeps (i6 §8.4). now/
  // monotonicNow/execGit are injectable for deterministic spot-check tests.
  isPro?: boolean;
  now?: () => string;
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
};

const recallInputSchema = z
  .object({
    sessionId: z.string().min(1),
    intent: z.string(),
    maxBytes: z.number().int().positive().optional(),
    // Bi-temporal time-travel: recall what we believed as of this instant.
    // Absent ⇒ now ⇒ currently-valid memories only.
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type RecallToolResult = {
  memory: readonly (MemoryEntry & {
    changedFrom?: ChangedFrom;
    verification: VerificationBadge;
  })[];
  chunkSets: readonly ChunkSetSummary[];
  contradictedByCode?: ContradictedDisclosure[];
};

export async function handleRecall(
  env: RecallToolEnv,
  rawArgs: unknown,
): Promise<RecallToolResult> {
  const parsed = recallInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const { sessionId, intent, asOf } = parsed.data;

  if (intent.trim() === "") {
    throw new McpBridgeError("intent_required", "mega_recall requires a non-empty intent");
  }
  const at = asOf ?? new Date().toISOString();

  return forwardOrFallback(
    env.storeRoot,
    "/recall-registry",
    { sessionId, intent, ...(asOf !== undefined ? { asOf } : {}) },
    async () => {
      const session = env.registry.getSession(sessionId as SessionId);
      if (session === null) {
        throw new McpBridgeError("session_not_found", `session not found: ${sessionId}`);
      }

      const allMemory = env.registry.listMemoryEntries(session.projectId);
      const recallable = allMemory.filter(
        (m) => isRecallable(m, at) && (m.sessionId === session.id || m.scope === "project"),
      );
      // Pre-recall spot-check (i6 §8.4). recall is unranked, so "top-5
      // anchored hits post-ranking" degrades to the first 5 anchored entries
      // in result order. Pro-only; free tier passes through unchanged.
      const project = env.registry.getProject(session.projectId);
      const check =
        project !== null
          ? await spotCheckHits(
              {
                registry: env.registry,
                isPro: env.isPro ?? false,
                now: env.now ?? (() => new Date().toISOString()),
                ...(env.monotonicNow !== undefined ? { monotonicNow: env.monotonicNow } : {}),
                ...(env.execGit !== undefined ? { execGit: env.execGit } : {}),
                ...(env.storeRoot !== undefined
                  ? { ledger: { storeRoot: env.storeRoot, sessionId: session.id } }
                  : {}),
              },
              project.rootPath,
              recallable,
            )
          : { hits: recallable, contradictedByCode: [] as ContradictedDisclosure[] };
      // changedFrom enrichment (response-only): the predecessor lookup is free
      // from the already-loaded allMemory. NOTE: the daemon /recall-registry
      // route has no server-side handler today; if one ever lands it must
      // mirror this enrichment AND the badge/spot-check above.
      const byId = new Map<string, MemoryEntry>(allMemory.map((m) => [m.id, m]));
      const memory = check.hits.map((m) => {
        const changedFrom = changedFromFor(m, byId);
        return {
          ...m,
          ...(changedFrom === undefined ? {} : { changedFrom }),
          verification: verificationBadgeFor(m),
        };
      });
      const chunkSets = await listChunkSets({
        storeRoot: env.storeRoot,
        projectId: session.projectId,
        sessionId: session.id,
      });

      return {
        memory,
        chunkSets,
        ...(check.contradictedByCode.length > 0
          ? { contradictedByCode: check.contradictedByCode }
          : {}),
      };
    },
  );
}
