import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsSentinel } from "@megasaver/connectors-shared";
import {
  type CoreRegistry,
  type MemoryEntry,
  appendCodeTruthEvent,
  tokensFromBytes,
} from "@megasaver/core";
import { extractBlocksForFile } from "@megasaver/output-filter";
import type { MemoryEntryId } from "@megasaver/shared";

export type VerificationBadge = "verified" | "contradicted-by-code" | "unanchored";

// FREE badge from STORED state only (spec §8.6): the anchor decides
// anchored/unanchored; a stored contradiction wins over everything else. An
// anchored row with no stored contradiction reads "verified" — the badge
// claims "anchored, no known contradiction", never a live check.
export function verificationBadgeFor(entry: MemoryEntry): VerificationBadge {
  if (entry.anchor === undefined) return "unanchored";
  if (entry.lastVerified?.result === "contradicted") return "contradicted-by-code";
  return "verified";
}

export const SPOT_CHECK_BUDGET_MS = 50;
export const SPOT_CHECK_TOP_N = 5;

export type ContradictedDisclosure = { id: string; title: string };

export type SpotCheckEnv = {
  registry: CoreRegistry;
  isPro: boolean;
  now: () => string;
  // Injectable for tests (spec §12): budget clock + git head resolver.
  monotonicNow?: () => number;
  execGit?: (args: string[], cwd: string) => string;
  // Savings ledger (i6 §10): when present, each demotion appends one
  // stale-recall-avoided event. sessionId comes from the caller (mega_recall
  // has a session; get_relevant_memories does not — its demotions fall back
  // to the memory's own sessionId or "unattributed").
  ledger?: { storeRoot: string; sessionId?: string; newId?: () => string };
};

export type SpotCheckResult<T extends MemoryEntry> = {
  hits: T[];
  contradictedByCode: ContradictedDisclosure[];
};

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 1500 }).trim();
}

// Pre-recall spot-check (spec §8.4). PRO only; FREE returns the input
// untouched. Inspects the top-5 anchored hits post-ranking, SYMBOL anchors
// only (file-only anchors contradict only on deletion-without-rename — §6.2 —
// and rename detection needs git history, which the ~50ms budget forbids; the
// full `mega memory verify` pass covers them). mtime pre-filter is a
// non-authoritative optimization (architect N5) — fail-open by design.
// Contradicted hits are excluded from the returned list and disclosed with
// sentinel-guarded titles; the stale/validTo flip persists inline and every
// write error is swallowed (architect M3: the response must always return).
export async function spotCheckHits<T extends MemoryEntry>(
  env: SpotCheckEnv,
  rootPath: string,
  ranked: readonly T[],
): Promise<SpotCheckResult<T>> {
  const passthrough: SpotCheckResult<T> = { hits: [...ranked], contradictedByCode: [] };
  if (!env.isPro) return passthrough;

  const clock = env.monotonicNow ?? Date.now;
  const started = clock();
  const overBudget = () => clock() - started > SPOT_CHECK_BUDGET_MS;

  let headSha: string;
  try {
    headSha = (env.execGit ?? defaultExecGit)(["rev-parse", "HEAD"], rootPath);
  } catch {
    return passthrough; // not a git repo / git missing — fail open
  }

  const anchored = ranked.filter((h) => h.anchor !== undefined).slice(0, SPOT_CHECK_TOP_N);
  const contradictedIds = new Set<string>();
  const disclosures: ContradictedDisclosure[] = [];

  for (const hit of anchored) {
    if (overBudget()) break; // fail-open: remaining hits pass through unchecked
    const anchor = hit.anchor;
    if (anchor === undefined || anchor.symbols.length === 0) continue;
    const capturedAtMs = Date.parse(anchor.capturedAt);
    const paths = [...new Set(anchor.symbols.map((s) => s.path))];
    let contradiction: { path: string; symbol: string; reason: string } | undefined;

    for (const path of paths) {
      if (overBudget() || contradiction !== undefined) break;
      const symbols = anchor.symbols.filter((s) => s.path === path);
      let source: string;
      try {
        // mtime pre-filter (§8.4): untouched since capture ⇒ skip re-hash.
        if (statSync(join(rootPath, path)).mtimeMs <= capturedAtMs) continue;
        source = readFileSync(join(rootPath, path), "utf8");
      } catch {
        // A stat/read fault cannot distinguish a rename from a deletion in the
        // ~50ms budget (no git history) — fail open and defer to the full
        // `mega memory verify` pass, which resolves renames. Never persist a
        // close from a disk fault.
        continue;
      }
      let blocks: Awaited<ReturnType<typeof extractBlocksForFile>>;
      try {
        blocks = await extractBlocksForFile(path, source);
      } catch {
        continue; // extractor failure is never a contradiction — fail open
      }
      if (blocks === undefined) continue; // unsupported extension: file anchor only
      for (const sym of symbols) {
        const candidates = blocks.filter((b) => b.name === sym.name);
        if (candidates.length === 0) {
          contradiction = { path, symbol: sym.name, reason: "symbol missing" };
          break;
        }
        // Name-collision rule (§6.2/N2): ANY candidate matching ⇒ verified;
        // ambiguity never produces a contradiction.
        if (!candidates.some((b) => b.contentHash === sym.contentHash)) {
          contradiction = { path, symbol: sym.name, reason: "symbol hash changed" };
          break;
        }
      }
    }
    if (contradiction === undefined) continue;

    contradictedIds.add(hit.id);
    disclosures.push({
      id: hit.id,
      title: containsSentinel(hit.title) ? "[title withheld: sentinel]" : hit.title,
    });
    // Flip persisted INLINE, fail-open (§7 contradicted bucket): stale, close
    // validTo ONLY when open (and own that close via closedByCodeTruth),
    // machine-composed evidence, lastVerified. NEVER touches lastActiveAt.
    let closed = false;
    try {
      const now = env.now();
      const open = hit.validTo === undefined || hit.validTo === null;
      env.registry.updateMemoryEntry(hit.id as MemoryEntryId, {
        stale: true,
        ...(open ? { validTo: now } : {}),
        evidence: [
          ...(hit.evidence ?? []),
          `code-truth: contradicted at ${headSha.slice(0, 7)} — ${contradiction.path}#${contradiction.symbol} ${contradiction.reason}`,
        ],
        lastVerified: {
          headSha,
          at: now,
          result: "contradicted",
          closedByCodeTruth: open,
        },
        updatedAt: now,
      });
      closed = true;
    } catch {
      // swallowed: the spot-check must never fail the recall response
    }
    // Ledger only when the close persisted — a persistently failing write keeps
    // the row open and re-contradicts every recall, so an unconditional append
    // would double-count the same avoided recall on each pass.
    if (closed && env.ledger !== undefined) {
      // Analytics only: the ledger append must never block or fail recall.
      try {
        appendCodeTruthEvent(
          { root: env.ledger.storeRoot },
          {
            type: "stale-recall-avoided",
            id: (env.ledger.newId ?? randomUUID)(),
            projectId: hit.projectId,
            sessionId: env.ledger.sessionId ?? hit.sessionId ?? "unattributed",
            memoryId: hit.id,
            avoidedTokens: tokensFromBytes(Buffer.byteLength(hit.content, "utf8")),
            estimated: true,
            createdAt: env.now(),
          },
        );
      } catch {
        // swallowed
      }
    }
  }

  return {
    hits: ranked.filter((h) => !contradictedIds.has(h.id)),
    contradictedByCode: disclosures,
  };
}
