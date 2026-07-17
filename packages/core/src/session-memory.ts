import { createHash } from "node:crypto";
import type { ProjectId, SessionId } from "@megasaver/shared";
import type { FailedAttempt } from "./failed-attempt.js";
import type { MemoryConfidence, MemoryScope, MemorySource, MemoryType } from "./memory-entry.js";

// M4 transcript→memory: a deterministic, no-LLM candidate distilled from a
// session's RECORDED failures, staged for the human approval gate. The CLI/MCP
// caller maps each candidate into a `suggested` MemoryEntry (never approves).
export type ExtractedCandidate = {
  type: MemoryType;
  source: MemorySource;
  scope: MemoryScope;
  confidence: MemoryConfidence;
  approval: "suggested";
  title: string;
  content: string;
  relatedFiles: string[];
  // Stable hash over (type + normalized title + content): identical failures
  // within a session collapse to one candidate.
  contentHash: string;
  // sourceFailureId:contentHash — the stable per-candidate key the caller uses
  // for cross-run idempotence (skip a candidate already staged from this source).
  dedupeKey: string;
  // Within-session collapse count: how many source failures produced this
  // candidate. Display + storm diagnostics only — NEVER a scoring input
  // (architect M2: single-session retry storms must not look important).
  occurrences: number;
};

export type ExtractSessionMemoriesInput = {
  sessionId: SessionId;
  projectId: ProjectId;
  // The session's failures (caller pre-filters listFailedAttempts to sessionId).
  failedAttempts: readonly FailedAttempt[];
};

// Test-shaped vs. generic failure. Coarse and deterministic on purpose — a
// human re-classifies at approve if wrong. Matches a test-runner/assertion
// vocabulary in the short failedStep label or the first error line.
const TEST_SHAPED =
  /\b(test|spec|assert(ion)?|expect(ed)?|vitest|jest|pytest|cargo test|go test)\b|\.test\.|\.spec\./i;

// An explicit human decision marker left in the captured failure text.
const DECISION_MARKER = /(?:^|\s)(?:DECISION:|decided to )\s*(.+)/i;

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").trim();
}

function hashOf(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function candidate(
  failureId: string,
  fields: Pick<ExtractedCandidate, "type" | "source" | "title" | "content" | "relatedFiles">,
): ExtractedCandidate {
  const contentHash = hashOf([fields.type, fields.title.toLowerCase(), fields.content]);
  return {
    scope: "session",
    confidence: "low",
    approval: "suggested",
    occurrences: 1,
    ...fields,
    contentHash,
    dedupeKey: `${failureId}:${contentHash}`,
  };
}

function failureCandidate(failure: FailedAttempt): ExtractedCandidate {
  const title = firstLine(failure.failedStep);
  const errorLine = failure.errorOutput !== undefined ? firstLine(failure.errorOutput) : "";
  const isTest = TEST_SHAPED.test(failure.failedStep) || TEST_SHAPED.test(errorLine);
  const contentParts = [`Failed step: ${failure.failedStep}`];
  if (errorLine.length > 0) contentParts.push(`Error: ${errorLine}`);
  if (failure.suspectedCause !== undefined)
    contentParts.push(`Suspected cause: ${failure.suspectedCause}`);
  return candidate(failure.id, {
    type: isTest ? "test_behavior" : "bug",
    source: "test_failure",
    title,
    content: contentParts.join("\n"),
    relatedFiles: [...failure.relatedFiles],
  });
}

function decisionCandidate(failure: FailedAttempt): ExtractedCandidate | undefined {
  for (const text of [failure.suspectedCause, failure.errorOutput]) {
    const match = text?.match(DECISION_MARKER);
    const decision = match?.[1]?.trim();
    if (decision !== undefined && decision.length > 0) {
      return candidate(failure.id, {
        type: "decision",
        source: "session_summary",
        title: firstLine(decision),
        content: `Decision: ${decision}`,
        relatedFiles: [...failure.relatedFiles],
      });
    }
  }
  return undefined;
}

// Idempotence ledger: every memory staged from an extracted candidate carries
// `from-session:<dedupeKey>` as a keyword, so ANY writer (CLI from-session,
// MCP from_session_memory, autopilot) can skip candidates already captured by
// any other. Promoted from duplicated local consts (architect m6) — three
// copies would drift.
export const DEDUPE_KEYWORD_PREFIX = "from-session:";

export function dedupeKeywordFor(dedupeKey: string): string {
  return `${DEDUPE_KEYWORD_PREFIX}${dedupeKey}`;
}

// The ledger namespace is internal-only: a keyword under it is a claim that a
// candidate was already captured, which the from-session/autopilot dedupe scan
// trusts. Agent-facing keyword writers (save_memory, memory create/update, brain
// import) strip these before the write, so an agent cannot plant a forged ledger
// entry to suppress a legitimate capture (denial-of-capture). Internal writers
// build the keyword themselves and bypass the strip.
export function isReservedKeyword(keyword: string): boolean {
  // Match the SAME normalization keywordsSchema (memory-entry.ts) applies to
  // stored keywords — `.trim().toLowerCase()`. The strip runs on raw input
  // BEFORE that normalization, so a case/whitespace forge like `From-Session:x`
  // or ` from-session:x ` would otherwise pass the guard, then be normalized
  // back into the reserved namespace on write and defeat the strip.
  return keyword.trim().toLowerCase().startsWith(DEDUPE_KEYWORD_PREFIX);
}

export function stripReservedKeywords(keywords: string[]): string[] {
  return keywords.filter((keyword) => !isReservedKeyword(keyword));
}

// Pure: no I/O, no clock, no model. Deterministic over already-structured
// FailedAttempt rows. Dedupes identical candidates within the session by
// contentHash so N identical failures collapse to 1.
export function extractSessionMemories(input: ExtractSessionMemoriesInput): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = [];
  const seen = new Map<string, ExtractedCandidate>();
  const push = (c: ExtractedCandidate | undefined): void => {
    if (c === undefined) return;
    const survivor = seen.get(c.contentHash);
    if (survivor !== undefined) {
      survivor.occurrences += 1;
      return;
    }
    seen.set(c.contentHash, c);
    out.push(c);
  };
  for (const failure of input.failedAttempts) {
    push(failureCandidate(failure));
    push(decisionCandidate(failure));
  }
  return out;
}
