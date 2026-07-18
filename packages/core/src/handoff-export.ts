import { estimateTokens } from "@megasaver/output-filter";
import type { ProjectPermissions } from "@megasaver/policy";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { makeRedactor, redactFailure, redactMemory } from "./brain-export.js";
import { sha256Hex } from "./bundle-frame.js";
import type { FailedAttempt } from "./failed-attempt.js";
import {
  HANDOFF_SCHEMA_VERSION,
  type HandoffManifest,
  type HandoffPacket,
  type HandoffPayload,
} from "./handoff-packet.js";
import { type MemoryEntry, effectiveConfidence, isRecallable } from "./memory-entry.js";
import type { ProjectRule } from "./project-rule.js";
import { verificationBadgeFor } from "./verification-badge.js";
import { type GitDelta, assembleWarmStartBrief } from "./warm-start.js";

// Defined here, not in apps/cli: core receives it as plain data in
// BuildHandoffPacketInput, mirroring the GitDelta precedent (warm-start.ts).
export interface HandoffDirtyState {
  headSha: string | null;
  dirty: boolean;
  statusPaths: { path: string; status: string }[];
  diffText: string | null;
}

export interface BuildHandoffPacketInput {
  projectName: string;
  projectId: ProjectId;
  sourceAgent: string;
  targetAgent: string;
  resumeInstructions: string;
  now: number;
  expiresAt: number;
  memories: MemoryEntry[];
  failedAttempts: FailedAttempt[];
  rules: ProjectRule[];
  sessionId: SessionId | null;
  gitDelta: GitDelta | null;
  dirtyState: HandoffDirtyState | null;
  permissions: ProjectPermissions | null;
  budgetTokens: number;
}

export interface HandoffPackReport {
  redactionFindings: number;
  secretPathsExcluded: number;
  excludedPaths: string[];
  counts: { memories: number; failures: number; diffFiles: number; commits: number };
  noOpenSession: boolean;
  degradedGit: boolean;
  badges: { memoryId: string; badge: string }[];
}

export interface BuildHandoffPacketResult {
  packet: HandoffPacket;
  report: HandoffPackReport;
}

const MEMORY_CAP = 20;
const FAILURE_CAP = 10;

type HandoffGit = HandoffPayload["git"];

function selectMemories(input: BuildHandoffPacketInput, nowIso: string): MemoryEntry[] {
  return input.memories
    .filter(
      (m) =>
        isRecallable(m, nowIso) &&
        !m.stale &&
        (m.scope === "project" || (input.sessionId !== null && m.sessionId === input.sessionId)),
    )
    .sort(
      (a, b) =>
        effectiveConfidence(b, nowIso) - effectiveConfidence(a, nowIso) || a.id.localeCompare(b.id),
    )
    .slice(0, MEMORY_CAP);
}

function selectFailures(input: BuildHandoffPacketInput): FailedAttempt[] {
  return input.failedAttempts
    .filter((f) => f.resolution === undefined && !f.convertedToRule)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, FAILURE_CAP);
}

function buildGit(input: BuildHandoffPacketInput): { git: HandoffGit; diffFiles: number } {
  if (input.gitDelta === null && input.dirtyState === null) return { git: null, diffFiles: 0 };
  return {
    git: {
      branch: input.gitDelta?.branch ?? null,
      headSha: input.dirtyState?.headSha ?? null,
      dirty: input.dirtyState?.dirty ?? false,
      commits: input.gitDelta?.commits ?? [],
      changedFiles: input.gitDelta?.changedFiles ?? [],
      diff: null,
    },
    diffFiles: 0,
  };
}

// Pure, no I/O. All registry and git data arrives pre-gathered; the CLI
// threads permissions and pre-renders resumeInstructions (no agent-specific
// logic in core).
export function buildHandoffPacket(input: BuildHandoffPacketInput): BuildHandoffPacketResult {
  const nowIso = new Date(input.now).toISOString();
  const r = makeRedactor();
  const excluded = new Set<string>();

  const selected = selectMemories(input, nowIso);
  const failures = selectFailures(input);
  const { git, diffFiles } = buildGit(input);

  // Explicit mode: never let selectWarmStartMode auto-pick — a handoff is
  // packed minutes after working and lastSeenAt<4h would collapse the brief
  // to the 300-token micro stub, ignoring budgetTokens (spec §5.7).
  const brief = assembleWarmStartBrief({
    projectName: input.projectName,
    branch: input.gitDelta?.branch ?? null,
    now: nowIso,
    budgetTokens: input.budgetTokens,
    mode: "standard",
    lastSeenAt: null,
    reonboardUnlocked: true,
    timeless: true,
    memories: input.memories,
    rules: input.rules,
    failedAttempts: input.failedAttempts,
    gitDelta: input.gitDelta,
  });
  const summaryText = r.text(brief.text);

  const payload: HandoffPayload = {
    taskSummary: { text: summaryText, tokenEstimate: estimateTokens(summaryText) },
    resumeInstructions: r.text(input.resumeInstructions),
    git,
    failures: failures.map((f) => redactFailure(f, r)),
    memories: selected.map((m) => redactMemory(m, r)),
  };

  const counts = {
    memories: payload.memories.length,
    failures: payload.failures.length,
    diffFiles,
    commits: git === null ? 0 : git.commits.length,
  };

  const manifest: HandoffManifest = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    kind: "megahandoff",
    sourceProject: { name: input.projectName },
    sourceAgent: input.sourceAgent,
    targetAgent: input.targetAgent,
    createdAt: nowIso,
    expiresAt: new Date(input.expiresAt).toISOString(),
    payloadSha256: sha256Hex(JSON.stringify(payload)),
    redactionFindings: r.total,
    secretPathsExcluded: excluded.size,
    counts,
  };

  return {
    packet: { manifest, payload },
    report: {
      redactionFindings: r.total,
      secretPathsExcluded: excluded.size,
      excludedPaths: [...excluded].sort(),
      counts,
      noOpenSession: input.sessionId === null,
      degradedGit: git === null,
      badges: selected.map((m) => ({ memoryId: m.id, badge: verificationBadgeFor(m) })),
    },
  };
}
