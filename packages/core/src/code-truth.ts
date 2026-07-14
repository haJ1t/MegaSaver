import type { MemoryEntryId } from "@megasaver/shared";
import type { CodeAnchor } from "./memory-anchor.js";
import type { MemoryEntry } from "./memory-entry.js";

export type ExtractedBlockLite = {
  name?: string;
  contentHash: string;
  startLine: number;
  endLine: number;
};

export type RepoState = {
  headSha: string;
  // path → current blob sha at HEAD, or "missing"
  blobs: ReadonlyMap<string, string | "missing">;
  // path → extracted blocks of the CURRENT worktree content (only for files
  // cited by symbol anchors, plus rename targets)
  blocks: ReadonlyMap<string, readonly ExtractedBlockLite[]>;
  // path → rename target discovered via `git diff -M` (present only when the
  // anchored path is missing and a rename was detected)
  renames: ReadonlyMap<string, string>;
  // path → falsifying commit sha (last commit touching path since anchor head)
  attribution: ReadonlyMap<string, string>;
};

export type VerifyPlan = {
  contradicted: Array<{ id: MemoryEntryId; reason: string; commit?: string }>;
  healed: MemoryEntryId[];
  verified: MemoryEntryId[];
  repointed: Array<{ id: MemoryEntryId; from: string; to: string }>;
  unanchored: MemoryEntryId[];
};

type Contradiction = { reason: string; path: string };

// First failing check for one entry, or undefined when every check passes.
// Contradiction policy (spec §6.2): a blob change ALONE never contradicts —
// file anchors are weak claims that only contradict on delete-without-rename;
// the unit of strong contradiction is the symbol hash. Name collisions at
// verify resolve optimistically: ANY same-name block matching the anchored
// hash verifies; contradiction only when none matches.
function firstContradiction(anchor: CodeAnchor, repo: RepoState): Contradiction | undefined {
  const effective = (path: string): string => repo.renames.get(path) ?? path;
  for (const file of anchor.files) {
    const blob = repo.blobs.get(effective(file.path)) ?? "missing";
    if (blob === "missing" && !repo.renames.has(file.path)) {
      return { reason: `${file.path} deleted`, path: file.path };
    }
  }
  for (const symbol of anchor.symbols) {
    const path = effective(symbol.path);
    const candidates = (repo.blocks.get(path) ?? []).filter(
      (candidate) => candidate.name === symbol.name,
    );
    if (candidates.length === 0) {
      return { reason: `${path}#${symbol.name} missing`, path };
    }
    if (!candidates.some((candidate) => candidate.contentHash === symbol.contentHash)) {
      return { reason: `${path}#${symbol.name} hash changed`, path };
    }
  }
  return undefined;
}

// Pure planner (spec §6.1) — fixture-testable, zero git. Heal is keyed
// STRICTLY on lastVerified.result === "contradicted" (architect B1: never
// evidence-string sniffing). The planner never inspects validTo: close
// ownership is an APPLY-time decision (runVerify), not a plan-time one.
// `now` is part of the pinned signature; timestamps are stamped at apply time.
export function verifyAnchors(
  entries: readonly MemoryEntry[],
  repo: RepoState,
  now: string,
): VerifyPlan {
  const plan: VerifyPlan = {
    contradicted: [],
    healed: [],
    verified: [],
    repointed: [],
    unanchored: [],
  };
  for (const entry of entries) {
    const anchor = entry.anchor;
    if (anchor === undefined) {
      plan.unanchored.push(entry.id);
      continue;
    }
    const cited = new Set<string>([
      ...anchor.files.map((file) => file.path),
      ...anchor.symbols.map((symbol) => symbol.path),
    ]);
    for (const path of cited) {
      const target = repo.renames.get(path);
      if (target !== undefined) {
        plan.repointed.push({ id: entry.id, from: path, to: target });
      }
    }
    const failure = firstContradiction(anchor, repo);
    if (failure !== undefined) {
      const commit = repo.attribution.get(failure.path);
      const reason =
        commit === undefined ? `${failure.reason} (uncommitted change)` : failure.reason;
      plan.contradicted.push({
        id: entry.id,
        reason,
        ...(commit !== undefined ? { commit } : {}),
      });
      continue;
    }
    if (entry.lastVerified?.result === "contradicted") {
      plan.healed.push(entry.id);
    } else {
      plan.verified.push(entry.id);
    }
  }
  return plan;
}
