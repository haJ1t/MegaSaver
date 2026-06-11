import type { ContextPack, ScoredBlock } from "./pack.js";
import { estimateSpanTokens } from "./select.js";

// Savings view (feeds Phase 8). tokensBefore = every considered block's
// estimated tokens (what a whole-file dump would cost); tokensAfter = the
// pack's usedTokens.
export type PackAudit = {
  filesConsidered: number;
  filesIncluded: number;
  filesExcluded: number;
  blocksConsidered: number;
  blocksIncluded: number;
  blocksExcluded: number;
  tokensBefore: number;
  tokensAfter: number;
  percentSaved: number;
};

function distinctFiles(blocks: readonly ScoredBlock[]): number {
  return new Set(blocks.map((block) => block.filePath)).size;
}

export function auditPack(pack: ContextPack): PackAudit {
  const all = [...pack.included, ...pack.excluded];
  const tokensBefore = all.reduce(
    (sum, block) => sum + estimateSpanTokens(block.startLine, block.endLine),
    0,
  );
  const tokensAfter = pack.budget.usedTokens;
  return {
    filesConsidered: distinctFiles(all),
    filesIncluded: distinctFiles(pack.included),
    filesExcluded: distinctFiles(pack.excluded),
    blocksConsidered: all.length,
    blocksIncluded: pack.included.length,
    blocksExcluded: pack.excluded.length,
    tokensBefore,
    tokensAfter,
    percentSaved:
      tokensBefore > 0 ? Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100) : 0,
  };
}
