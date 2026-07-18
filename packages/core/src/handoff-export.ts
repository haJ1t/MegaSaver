import { compressByCategory, estimateTokens } from "@megasaver/output-filter";
import { type ProjectPermissions, evaluatePathRead } from "@megasaver/policy";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { type Redactor, makeRedactor, redactFailure, redactMemory } from "./brain-export.js";
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

// No cap value in the spec; parity with DEFAULT_WARM_START_BUDGET so the diff
// excerpt cannot dwarf the brief it accompanies.
export const HANDOFF_DIFF_TOKEN_CAP = 2000;

type HandoffGit = HandoffPayload["git"];

function pathAllowed(
  path: string,
  projectId: ProjectId,
  permissions: ProjectPermissions | null,
): boolean {
  return evaluatePathRead({
    path,
    project: projectId,
    ...(permissions === null ? {} : { permissions }),
  }).allowed;
}

type FileChunk = { path: string; text: string };

// `git diff` C-quotes exotic (non-ASCII/special) paths as `"b/<escaped>"`.
// Strip the wrapper so the deny-glob sees the real extension/segments — the
// `.env`/`secrets/` anchors survive un-decoded and `.*` spans the escape
// bytes. Without this the whole header line becomes the "path", matches no
// secret glob, and evaluatePathRead (fail-open) would KEEP the secret hunk.
function headerPath(line: string): string {
  const quoted = line.lastIndexOf(' "b/');
  if (quoted !== -1 && line.endsWith('"')) return line.slice(quoted + 4, -1);
  const at = line.lastIndexOf(" b/");
  return at === -1 ? line : line.slice(at + 3);
}

function splitDiffByFile(diffText: string): FileChunk[] {
  const chunks: FileChunk[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current !== null) chunks.push({ path: current.path, text: current.lines.join("\n") });
      current = { path: headerPath(line), lines: [line] };
      continue;
    }
    current?.lines.push(line);
  }
  if (current !== null) chunks.push({ path: current.path, text: current.lines.join("\n") });
  return chunks;
}

function selectMemories(memories: MemoryEntry[], nowIso: string): MemoryEntry[] {
  return memories
    .filter((m) => isRecallable(m, nowIso) && !m.stale)
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

// Ordered, all steps mandatory (spec §5.4): split per-file hunks →
// evaluatePathRead drop (same threaded permissions on EVERY call, incl.
// changedFiles and porcelain paths — existence disclosure is a leak too) →
// redact → compress → token cap dropping whole trailing chunks.
function buildGit(
  input: BuildHandoffPacketInput,
  r: Redactor,
  excluded: Set<string>,
): { git: HandoffGit; diffFiles: number } {
  if (input.gitDelta === null && input.dirtyState === null) return { git: null, diffFiles: 0 };

  const changedFiles = (input.gitDelta?.changedFiles ?? []).filter((f) => {
    if (pathAllowed(f.path, input.projectId, input.permissions)) return true;
    excluded.add(f.path);
    return false;
  });
  for (const s of input.dirtyState?.statusPaths ?? []) {
    if (!pathAllowed(s.path, input.projectId, input.permissions)) excluded.add(s.path);
  }

  let diff: NonNullable<HandoffGit>["diff"] = null;
  let diffFiles = 0;
  const diffText = input.dirtyState?.diffText ?? null;
  if (diffText !== null) {
    const kept: FileChunk[] = [];
    for (const chunk of splitDiffByFile(diffText)) {
      if (pathAllowed(chunk.path, input.projectId, input.permissions)) kept.push(chunk);
      else excluded.add(chunk.path);
    }
    const compressed = kept.map((c) => ({
      path: c.path,
      text: compressByCategory("diff", r.text(c.text)).text,
    }));
    const included: FileChunk[] = [];
    let truncated = false;
    for (const chunk of compressed) {
      const candidate = [...included.map((c) => c.text), chunk.text].join("\n");
      if (estimateTokens(candidate) > HANDOFF_DIFF_TOKEN_CAP) {
        truncated = true;
        break;
      }
      included.push(chunk);
    }
    diffFiles = new Set(included.map((c) => c.path)).size;
    diff = {
      text: included.map((c) => c.text).join("\n"),
      truncated,
      excludedPaths: [...excluded].sort(),
    };
  }

  return {
    git: {
      // gitDelta and dirtyState can degrade independently; one null with the
      // other present still reads degradedGit=false with a partially-filled
      // git object — by design until T10 wires real gathering, where both come
      // from one probe.
      branch: input.gitDelta?.branch ?? null,
      headSha: input.dirtyState?.headSha ?? null,
      dirty: input.dirtyState?.dirty ?? false,
      // review 5a: subjects are free text — must stay redacted after 5b replaces buildGit
      commits: (input.gitDelta?.commits ?? []).map((c) => ({ ...c, subject: r.text(c.subject) })),
      changedFiles,
      diff,
    },
    diffFiles,
  };
}

// Pure, no I/O. All registry and git data arrives pre-gathered; the CLI
// threads permissions and pre-renders resumeInstructions (no agent-specific
// logic in core).
export function buildHandoffPacket(input: BuildHandoffPacketInput): BuildHandoffPacketResult {
  const nowIso = new Date(input.now).toISOString();
  const r = makeRedactor();
  const excluded = new Set<string>();

  // Scope BEFORE the brief, not just the payload: assembleWarmStartBrief only
  // filters recallable/stale, so an unscoped list would leak foreign-session
  // content into taskSummary.text while payload.memories correctly drops it.
  const scoped = input.memories.filter(
    (m) => m.scope === "project" || (input.sessionId !== null && m.sessionId === input.sessionId),
  );
  const selected = selectMemories(scoped, nowIso);
  const failures = selectFailures(input);
  const { git, diffFiles } = buildGit(input, r, excluded);

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
    memories: scoped,
    rules: input.rules,
    failedAttempts: failures,
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
