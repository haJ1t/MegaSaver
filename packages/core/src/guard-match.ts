import type { GuardCorpusRow } from "@megasaver/context-gate";
import { rankBm25 } from "@megasaver/retrieval";
import type { FailedAttempt } from "./failed-attempt.js";

// Pure, deterministic Mistake Firewall matcher (spec 2026-07-12 §3.2). No
// I/O, no clock reads — the caller passes `asOf`. Three tiers, first hit
// wins. The table-driven test suite in guard-match.test.ts is the tuning
// authority for the constants below.
export const GUARD_T1_MAX_AGE_DAYS = 30;
// Tuned down from the plan's 1.5: a near-verbatim stale replay
// ("pnpm vitest run --shard 2 --reporter dot" vs stored "pnpm vitest
// --shard 2") scores 1.274 under rankBm25, a true positive the 1.5 floor
// rejected. 1.2 still needs ~4 strong shared terms; noise (single common
// word ≈0.29, 2 terms ≈0.55) stays well below. The test table is authority.
export const GUARD_T3_MIN_SCORE = 1.2;
export const GUARD_T3_MARGIN = 1.5;

export type GuardCandidate =
  | { kind: "failed-attempt"; attempt: FailedAttempt }
  | { kind: "auto-capture"; row: GuardCorpusRow };

export type GuardToolCall =
  | { tool: "Bash"; command: string }
  | { tool: "Edit" | "Write" | "MultiEdit" | "NotebookEdit"; filePath: string; text: string };

export type GuardMatchInput = {
  call: GuardToolCall;
  candidates: GuardCandidate[];
  mutedIds: string[];
  firedIds: string[];
  asOf: string;
};

export type GuardMatch = {
  candidate: GuardCandidate;
  tier: "t1" | "t2" | "t3";
  action: "warn" | "deny-capable" | "recall";
};

// Whitespace-only normalization. We deliberately do NOT strip leading
// `VAR=val` env prefixes: env vars change behavior (`NODE_ENV=production npm
// build` is a different command from `npm build`, and is often the *fix* for a
// failure), so conflating them at the exact tier would produce false T1 denies.
// `\s+` is linear (no backtracking) so it is safe on adversarially large input.
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function guardCandidateId(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt" ? candidate.attempt.id : candidate.row.id;
}

export function guardCandidateCreatedAt(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt"
    ? candidate.attempt.createdAt
    : candidate.row.createdAt;
}

export function guardCandidateErrorOutput(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt"
    ? (candidate.attempt.errorOutput ?? "")
    : candidate.row.errorOutput;
}

function candidateCommand(candidate: GuardCandidate): string {
  return candidate.kind === "failed-attempt" ? candidate.attempt.failedStep : candidate.row.command;
}

function candidateResolution(candidate: GuardCandidate): string | undefined {
  return candidate.kind === "failed-attempt" ? candidate.attempt.resolution : undefined;
}

// FailedAttempt text surface mirrors searchFailedAttempts; corpus rows use
// command + errorOutput.
function candidateText(candidate: GuardCandidate): string {
  if (candidate.kind === "auto-capture") {
    return `${candidate.row.command} ${candidate.row.errorOutput}`;
  }
  const a = candidate.attempt;
  return `${a.task} ${a.failedStep} ${a.errorOutput ?? ""} ${a.suspectedCause ?? ""}`;
}

function ageDays(createdAt: string, asOf: string): number {
  return (Date.parse(asOf) - Date.parse(createdAt)) / 86_400_000;
}

// Normalized relative-path suffix match: "/repo/src/auth/x.ts" hits
// "src/auth/x.ts" and vice versa; "auth/x.ts" vs "other/x.ts" misses.
function pathsIntersect(filePath: string, relatedFiles: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const a = norm(filePath);
  return relatedFiles.some((rel) => {
    const b = norm(rel);
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return longer === shorter || longer.endsWith(`/${shorter}`);
  });
}

function bm25Top(
  query: string,
  candidates: GuardCandidate[],
): { first: { candidate: GuardCandidate; score: number } | null; second: number } {
  if (query.trim() === "" || candidates.length === 0) return { first: null, second: 0 };
  const byId = new Map(candidates.map((c) => [guardCandidateId(c), c]));
  const ranked = rankBm25({
    query,
    documents: candidates.map((c) => ({ id: guardCandidateId(c), text: candidateText(c) })),
    topN: 2,
  }).filter((hit) => hit.score > 0);
  const top = ranked[0];
  if (top === undefined) return { first: null, second: 0 };
  const candidate = byId.get(top.id);
  if (candidate === undefined) return { first: null, second: 0 };
  return { first: { candidate, score: top.score }, second: ranked[1]?.score ?? 0 };
}

export function matchGuard(input: GuardMatchInput): GuardMatch | null {
  const excluded = new Set([...input.mutedIds, ...input.firedIds]);
  const candidates = input.candidates.filter(
    (c) =>
      !excluded.has(guardCandidateId(c)) &&
      !(c.kind === "failed-attempt" && c.attempt.convertedToRule),
  );
  if (candidates.length === 0) return null;

  if (input.call.tool === "Bash") {
    const normalized = normalizeCommand(input.call.command);
    // T1 exact: unresolved + younger than 30 days (strict <) → deny-capable;
    // resolved matches emit positive recall instead.
    for (const c of candidates) {
      if (normalizeCommand(candidateCommand(c)) !== normalized) continue;
      if (candidateResolution(c) !== undefined) {
        return { candidate: c, tier: "t1", action: "recall" };
      }
      if (ageDays(guardCandidateCreatedAt(c), input.asOf) < GUARD_T1_MAX_AGE_DAYS) {
        return { candidate: c, tier: "t1", action: "deny-capable" };
      }
    }
    // T3 BM25: conservative threshold + top-1 margin.
    const { first, second } = bm25Top(normalized, candidates);
    if (
      first !== null &&
      first.score >= GUARD_T3_MIN_SCORE &&
      (second === 0 || first.score >= GUARD_T3_MARGIN * second)
    ) {
      const action = candidateResolution(first.candidate) !== undefined ? "recall" : "warn";
      return { candidate: first.candidate, tier: "t3", action };
    }
    return null;
  }

  // T2 path (edit tools): FailedAttempt-only, BOTH signals required.
  const withPath = candidates.filter(
    (c): c is Extract<GuardCandidate, { kind: "failed-attempt" }> =>
      c.kind === "failed-attempt" &&
      c.attempt.relatedFiles.length > 0 &&
      pathsIntersect((input.call as { filePath: string }).filePath, c.attempt.relatedFiles),
  );
  const { first } = bm25Top((input.call as { text: string }).text, withPath);
  if (first !== null) {
    const action = candidateResolution(first.candidate) !== undefined ? "recall" : "warn";
    return { candidate: first.candidate, tier: "t2", action };
  }
  return null;
}
