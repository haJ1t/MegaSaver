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

// Pure: no I/O, no clock, no model. Deterministic over already-structured
// FailedAttempt rows. Dedupes identical candidates within the session by
// contentHash so N identical failures collapse to 1.
export function extractSessionMemories(input: ExtractSessionMemoriesInput): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ExtractedCandidate | undefined): void => {
    if (c === undefined || seen.has(c.contentHash)) return;
    seen.add(c.contentHash);
    out.push(c);
  };
  for (const failure of input.failedAttempts) {
    push(failureCandidate(failure));
    push(decisionCandidate(failure));
  }
  return out;
}
