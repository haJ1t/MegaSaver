import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import type { AutopilotPolicy } from "./autopilot-store.js";
import { checkConflicts } from "./conflict-checker.js";
import type { FailedAttempt } from "./failed-attempt.js";
import { captureCodeAnchor } from "./memory-anchor.js";
import { type MemoryConfidence, type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";
import {
  DEDUPE_KEYWORD_PREFIX,
  type ExtractedCandidate,
  dedupeKeywordFor,
  extractSessionMemories,
} from "./session-memory.js";
import {
  AUTOPILOT_EVIDENCE_PREFIX,
  type WriteResolution,
  defaultWriteExpiresAt,
  verifyMemoryWrite,
} from "./write-verify.js";

export { AUTOPILOT_EVIDENCE_PREFIX };

// Auditable marker for "auto-approved while you were away" (spec §8.3):
// digest.ts detects autopilot-written rows via AUTOPILOT_EVIDENCE_PREFIX, so
// writer and reader must share one definition or detection silently drifts.
// The constant lives in write-verify.ts (the closed-form classification table)
// and is re-exported here so the existing index surface keeps working.

export function formatAutopilotEvidence(sessionId: SessionId): string {
  return `${AUTOPILOT_EVIDENCE_PREFIX} rule=recurring-failure session=${sessionId}`;
}

export type ScoreSignals = { priorSessionHit: boolean };

// Deterministic rule table (spec §5.1) — no LLM, no clock, no I/O.
// priorSessionHit (computed by the caller): this candidate's contentHash also
// appeared among candidates extracted from a DIFFERENT session's failures.
// M2 dampener: `occurrences` (within-session repetition) is deliberately NOT
// an input — a retry storm inside one session must never auto-approve.
export function scoreCandidate(
  candidate: ExtractedCandidate,
  signals: ScoreSignals,
): MemoryConfidence {
  const isFailureType = candidate.type === "bug" || candidate.type === "test_behavior";
  if (isFailureType && signals.priorSessionHit) return "high";
  // "high" is the auto-approval score and this rule table is its only gate, so
  // the non-recurring branch clamps it away: the guarantee must hold here
  // structurally, not depend on the extractor hardcoding `confidence: "low"`.
  return candidate.confidence === "high" ? "medium" : candidate.confidence;
}

export type RunAutopilotResult = {
  autoApproved: MemoryEntry[];
  staged: MemoryEntry[];
  skippedExisting: number;
  cappedOut: number;
};

// The capture engine (spec §5.2). Creates NEW rows only — never mutates an
// existing entry; semantic-dup detection stays off (architect #5: N terse
// candidates sharing a session's files would mass-auto-link against approved
// rows and prime a bulk-approval mass-close).
export async function runAutopilot(opts: {
  registry: CoreRegistry;
  projectId: ProjectId;
  sessionId: SessionId;
  policy: AutopilotPolicy;
  now: string;
  newId: () => string;
  dryRun?: boolean;
}): Promise<RunAutopilotResult> {
  const { registry, projectId, sessionId, policy, now, newId } = opts;
  const dryRun = opts.dryRun === true;

  const allFailures = registry.listFailedAttempts(projectId);
  const candidates = extractSessionMemories({
    sessionId,
    projectId,
    failedAttempts: allFailures.filter((f) => f.sessionId === sessionId),
  });

  const existingDedupeKeywords = new Set(
    registry
      .listMemoryEntries(projectId)
      .flatMap((m) => m.keywords)
      .filter((k) => k.startsWith(DEDUPE_KEYWORD_PREFIX)),
  );

  // M2 dampener signal: re-extract the project's OTHER sessions' failures
  // with the same pure extractor and collect their contentHashes. Grouping
  // preserves per-session collapse semantics; the extractor never emits its
  // input sessionId, so passing the current one for every group is safe.
  // Key is SessionId, not FailedAttempt["sessionId"] (which admits null): the
  // guard below makes a null key unreachable, so the compiler holds the
  // invariant rather than this comment.
  const bySession = new Map<SessionId, FailedAttempt[]>();
  for (const failureRow of allFailures) {
    // A null sessionId is the ABSENCE of a session, never a different one:
    // `null !== sessionId` would silently promote sessionless rows into a
    // pseudo-prior-session and forge the precondition this rule attests to.
    // Three writers emit null — MCP record_failed_attempt without sessionId,
    // `mega fail record` without --session, and every brain-import row — so an
    // agent could otherwise manufacture its own auto-approval, and an imported
    // corpus (all-null) would stand in as a permanent prior bucket. An import
    // is not evidence the user hit the bug twice.
    if (failureRow.sessionId === null || failureRow.sessionId === sessionId) continue;
    const group = bySession.get(failureRow.sessionId);
    if (group === undefined) bySession.set(failureRow.sessionId, [failureRow]);
    else group.push(failureRow);
  }
  const priorHashes = new Set<string>();
  for (const group of bySession.values()) {
    for (const prior of extractSessionMemories({ sessionId, projectId, failedAttempts: group })) {
      priorHashes.add(prior.contentHash);
    }
  }

  const project = registry.getProject(projectId);
  const result: RunAutopilotResult = {
    autoApproved: [],
    staged: [],
    skippedExisting: 0,
    cappedOut: 0,
  };

  for (const candidate of candidates) {
    const dedupeKeyword = dedupeKeywordFor(candidate.dedupeKey);
    if (existingDedupeKeywords.has(dedupeKeyword)) {
      result.skippedExisting += 1;
      continue;
    }

    const priorSessionHit = priorHashes.has(candidate.contentHash);
    const score = scoreCandidate(candidate, { priorSessionHit });
    const qualified = policy.autoApproveTypes.includes(candidate.type) && score === "high";
    const approve = qualified && result.autoApproved.length < policy.maxAutoApprovesPerSession;
    if (qualified && !approve) result.cappedOut += 1;

    // ponytail: one capture (~1 git spawn per cited file) per candidate —
    // same ceiling as from-session; batch through RepoState if volume grows.
    const anchor =
      project === null || candidate.relatedFiles.length === 0
        ? undefined
        : await captureCodeAnchor({
            rootPath: project.rootPath,
            relatedFiles: candidate.relatedFiles,
            now,
          });

    // Write gate (memory write-verify follow-up): qualified candidates claim
    // the autopilot attestation pointer — resolved by construction, because
    // qualification already required cross-session recurrence; everyone else
    // resolves zero pointers. Auto-approve additionally requires a clean
    // conflict corpus: autopilot IS a promotion path, so duplicate /
    // supersession / contradiction all block it (the human approve gate
    // remains the promotion path for those, exactly as for save_memory rows).
    const gated = candidate.source === "test_failure";
    const approvedActive = registry
      .listMemoryEntries(projectId)
      .filter((m) => m.approval === "approved" && !m.stale);
    const gateCandidate = {
      id: "00000000-0000-4000-8000-000000000000" as MemoryEntryId,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      keywords: [dedupeKeyword],
      relatedFiles: candidate.relatedFiles,
    };
    const resolution: WriteResolution = {
      resolutions:
        gated && qualified
          ? [
              {
                pointer: formatAutopilotEvidence(sessionId),
                kind: "autopilot_attestation",
                resolved: true,
              },
            ]
          : [],
      unresolvedSecret: false,
      hasRevoked: false,
      hasCrossWorkspace: false,
      resolverUnavailable: false,
    };
    const normalized = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");
    const droppedCitedFiles =
      anchor === undefined
        ? candidate.relatedFiles.map(normalized)
        : candidate.relatedFiles
            .map(normalized)
            .filter(
              (f) =>
                !anchor.files.some((a) => a.path === f) &&
                !anchor.symbols.some((a) => a.path === f),
            );
    const verdict = gated
      ? verifyMemoryWrite({
          candidate: gateCandidate,
          callerConfidence: approve ? "high" : candidate.confidence,
          callerApproval: approve ? "approved" : "suggested",
          approvedActive,
          resolution,
          droppedCitedFiles,
        })
      : undefined;
    const conflict = gated ? checkConflicts(gateCandidate, approvedActive) : undefined;
    const blockedByConflict = conflict !== undefined && conflict.outcome !== "unrelated";
    const autoApprove = approve && verdict?.outcome === "verified" && !blockedByConflict;

    const entry: MemoryEntry = memoryEntrySchema.parse({
      id: newId(),
      projectId,
      sessionId,
      scope: candidate.scope,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      keywords: [dedupeKeyword],
      confidence: blockedByConflict
        ? "low"
        : (verdict?.confidence ?? (approve ? "high" : candidate.confidence)),
      source: candidate.source,
      approval: autoApprove ? "approved" : "suggested",
      ...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),
      ...(anchor !== undefined ? { anchor } : {}),
      ...(gated ? { expiresAt: defaultWriteExpiresAt(now) } : {}),
      ...(autoApprove
        ? {
            validFrom: now,
            lastActiveAt: now,
            evidence: [formatAutopilotEvidence(sessionId)],
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });

    // Direct write, where from-session reaches the same place via
    // saveMemoryWithLineage(..., { detect: false }) — which short-circuits to
    // exactly this call (supersession.ts). Autopilot skips the helper because
    // `detect: false` does not disable supersession: the explicit-supersedesId
    // branch runs BEFORE that short-circuit, and these rows are born approved,
    // so a supersedesId reaching one would close existing memory. Writing
    // direct makes "autopilot never supersedes" structural instead of a
    // property of an argument staying correct.
    if (!dryRun) {
      registry.createMemoryEntry(entry);
      if (verdict !== undefined) {
        // Best-effort, mirrors save_memory: a sidecar failure never fails the write.
        try {
          registry.setMemoryValidation({
            memoryEntryId: entry.id,
            validationStatus: blockedByConflict ? "quarantined" : verdict.validationStatus,
            reasons:
              blockedByConflict && conflict?.outcome === "contradiction"
                ? [...verdict.reasons]
                : blockedByConflict
                  ? [...verdict.reasons, ...(conflict?.reasons ?? [])]
                  : [...verdict.reasons],
            conflictIds: blockedByConflict
              ? [...(conflict?.conflictIds ?? [])]
              : [...verdict.conflictIds],
            validatedAt: now,
            validatedBy: "system",
            policyVersion: "1",
          });
        } catch {
          // best-effort — see above
        }
      }
    }
    (autoApprove ? result.autoApproved : result.staged).push(entry);
  }

  return result;
}
