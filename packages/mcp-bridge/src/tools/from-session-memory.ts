import {
  type CoreRegistry,
  CoreRegistryError,
  DEDUPE_KEYWORD_PREFIX,
  type MemoryEntry,
  dedupeKeywordFor,
  defaultWriteExpiresAt,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
  verifyMemoryWrite,
} from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { z } from "zod";
import { McpBridgeError } from "../errors.js";
import { resolveWritePointers } from "../write-verify-resolver.js";

// `now`/`newId` are injectable so the boundary is deterministic in tests — they
// stamp each staged memory's id and createdAt/updatedAt. `storeRoot` feeds the
// write gate (absent ⇒ resolver_unavailable ⇒ unverified, write still lands).
export type FromSessionMemoryEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  storeRoot?: string;
};

export type FromSessionMemoryResult = { suggested: number; skipped: number };

export const fromSessionMemoryInputSchema = z.object({ sessionId: z.string().min(1) }).strict();

// M4 transcript→memory (MCP analog of `mega memory from-session`): deterministically
// distill a session's RECORDED failures into `suggested` memories for the human
// approval gate. NO LLM — pure heuristics over already-structured FailedAttempt
// rows. Never auto-approves; M3 surfaces semantic dups at approve. Idempotent.
export async function handleFromSessionMemory(
  env: FromSessionMemoryEnv,
  rawArgs: unknown,
): Promise<FromSessionMemoryResult> {
  const parsed = fromSessionMemoryInputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new McpBridgeError("validation_failed", parsed.error.message);
  }
  const sessionId = parsed.data.sessionId as SessionId;

  try {
    const session = env.registry.getSession(sessionId);
    if (!session) {
      throw new McpBridgeError("resource_not_found", `Session does not exist: ${sessionId}`);
    }

    const failedAttempts = env.registry
      .listFailedAttempts(session.projectId)
      .filter((a) => a.sessionId === sessionId);
    const candidates = extractSessionMemories({
      sessionId,
      projectId: session.projectId,
      failedAttempts,
    });

    const staged = new Set(
      env.registry
        .listMemoryEntries(session.projectId)
        .flatMap((m) => m.keywords)
        .filter((k) => k.startsWith(DEDUPE_KEYWORD_PREFIX)),
    );

    let suggested = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const dedupeKeyword = dedupeKeywordFor(candidate.dedupeKey);
      if (staged.has(dedupeKeyword)) {
        skipped += 1;
        continue;
      }
      const entry: MemoryEntry = memoryEntrySchema.parse({
        id: env.newId(),
        projectId: session.projectId,
        sessionId,
        scope: candidate.scope,
        type: candidate.type,
        title: candidate.title,
        content: candidate.content,
        keywords: [dedupeKeyword],
        confidence: candidate.confidence,
        source: candidate.source,
        approval: candidate.approval,
        ...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),
        createdAt: env.now(),
        updatedAt: env.now(),
      });
      // detect: false (living brain, architect #5): N terse extracted candidates
      // sharing the same session files would mass-auto-link against approved
      // rows and prime a bulk-approval mass-close. The from-session: dedupe
      // keyword stays the only dedupe on this path.
      // Write gate (Decision 5, amendment C): test_failure candidates are
      // gated like save_memory — no evidence pointers here, so the verdict is
      // unverified: confidence low, approval suggested, default TTL, sidecar
      // quarantined. session_summary candidates stay outside the locked set.
      let stagedEntry = entry;
      let verdict: ReturnType<typeof verifyMemoryWrite> | undefined;
      if (entry.source === "test_failure") {
        const project = env.registry.getProject(session.projectId);
        if (project !== null) {
          const resolution = await resolveWritePointers({
            storeRoot: env.storeRoot,
            evidence: [],
            projectRootPath: project.rootPath,
            projectId: session.projectId,
            sessionId,
          });
          const approvedActive = env.registry
            .listMemoryEntries(session.projectId)
            .filter((m) => m.approval === "approved" && !m.stale && m.id !== entry.id);
          verdict = verifyMemoryWrite({
            candidate: entry,
            callerConfidence: entry.confidence,
            callerApproval: entry.approval,
            approvedActive,
            resolution,
            // Engine-recorded files, not agent-claimed at save: no anchor claim
            // is made, so nothing is counted as dropped.
            droppedCitedFiles: [],
          });
          stagedEntry = memoryEntrySchema.parse({
            ...entry,
            confidence: verdict.confidence,
            approval: verdict.approval,
            expiresAt: defaultWriteExpiresAt(entry.createdAt),
          });
        }
      }
      const result = saveMemoryWithLineage(env.registry, stagedEntry, {
        now: env.now,
        detect: false,
      });
      if (result.deduped === undefined && verdict !== undefined) {
        env.registry.setMemoryValidation({
          memoryEntryId: result.entry.id,
          validationStatus: verdict.validationStatus,
          reasons: [...verdict.reasons],
          conflictIds: [...verdict.conflictIds],
          validatedAt: env.now(),
          validatedBy: "system",
          policyVersion: "1",
        });
      }
      staged.add(dedupeKeyword);
      suggested += 1;
    }

    return { suggested, skipped };
  } catch (err) {
    if (err instanceof CoreRegistryError && err.code === "project_not_found") {
      throw new McpBridgeError("resource_not_found", err.message);
    }
    throw err;
  }
}
