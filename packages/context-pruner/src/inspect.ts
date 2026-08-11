import { createHash } from "node:crypto";

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
  const canonical = JSON.stringify(cfg, Object.keys(cfg as object).sort());
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
  const keptTokens = kept.reduce((s, b) => s + Math.ceil(b.filePath.length / 4 + 10), 0);
  const droppedTokens = dropped.reduce((s, b) => s + Math.ceil(b.filePath.length / 4 + 10), 0);
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
