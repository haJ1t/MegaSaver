import { createHash } from "node:crypto";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type DropReason = "budget" | "rank" | "policy" | "dedup" | "stale";

export type KeptBlock = {
  blockId: string;
  filePath: string;
  score: number;
  rank: number;
  chunkSetId?: string;
};

export type DroppedBlock = KeptBlock & {
  reason: DropReason;
  droppedAtRank: number;
};

export type DropReport = {
  version: 1;
  query: string;
  budget: number;
  kept: KeptBlock[];
  dropped: DroppedBlock[];
  counters: {
    totalBlocks: number;
    totalTokens: number;
    keptTokens: number;
    droppedTokens: number;
    budgetUtilization: number;
  };
  scorerConfigHash: string;
};

export function hashScorerConfig(cfg: unknown): string {
  const canonical = JSON.stringify(cfg, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value as unknown;
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function inspectPack(input: {
  query: string;
  kept: KeptBlock[];
  dropped: DroppedBlock[];
  budget: number;
  scorerConfig: unknown;
  totalTokens?: number;
}): DropReport {
  const kept = [...input.kept].sort(
    (a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId),
  );
  const dropped = [...input.dropped].sort((a, b) => a.rank - b.rank);
  const totalBlocks = kept.length + dropped.length;
  const keptTokens = kept.reduce((s, b) => s + estimateTokens(b.filePath), 0);
  const droppedTokens = dropped.reduce((s, b) => s + estimateTokens(b.filePath), 0);
  const totalTokens = keptTokens + droppedTokens;
  return {
    version: 1,
    query: input.query,
    budget: input.budget,
    kept,
    dropped,
    counters: {
      totalBlocks,
      totalTokens,
      keptTokens,
      droppedTokens,
      budgetUtilization: input.budget > 0 ? keptTokens / input.budget : 0,
    },
    scorerConfigHash: hashScorerConfig(input.scorerConfig),
  };
}
