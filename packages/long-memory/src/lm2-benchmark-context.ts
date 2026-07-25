import { workspaceKeySchema } from "@megasaver/shared";
import { Lm2Error } from "./lm2-errors.js";
import type { Lm2Candidate } from "./lm2-model.js";
import { MAX_LM2_LANE_HITS, parseRankCandidates } from "./lm2-ranking-core.js";

export type Lm2BenchmarkRankedCandidate = {
  candidate: Lm2Candidate;
  score: number;
};

export class Lm2BenchmarkContextBuilder {
  build(_input: {
    workspaceKey: string;
    tokenBudget: number;
    orderedCandidates: readonly Lm2BenchmarkRankedCandidate[];
  }): {
    items: readonly { type: "text"; value: string; observationId: string }[];
    receipt: {
      selected: readonly { id: string; score: number; tokenCount: number }[];
      omitted: readonly { id: string; reason: "omitted_budget" }[];
      candidateCount: number;
    };
  } {
    const workspaceKey = workspaceKeySchema.safeParse(_input.workspaceKey);
    if (
      !workspaceKey.success ||
      !Number.isInteger(_input.tokenBudget) ||
      _input.tokenBudget < 1 ||
      _input.tokenBudget > 100_000 ||
      _input.orderedCandidates.length > MAX_LM2_LANE_HITS
    ) {
      throw new Lm2Error("invalid_input", "Invalid LM2 benchmark context request.");
    }
    const candidates = parseRankCandidates(
      _input.orderedCandidates.map(({ candidate }) => candidate),
      workspaceKey.data,
    );
    const items: { type: "text"; value: string; observationId: string }[] = [];
    const selected: { id: string; score: number; tokenCount: number }[] = [];
    const omitted: { id: string; reason: "omitted_budget" }[] = [];
    let usedTokens = 0;
    for (const [index, candidate] of candidates.entries()) {
      const score = _input.orderedCandidates[index]?.score;
      if (score === undefined || !Number.isFinite(score) || score < 0) {
        throw new Lm2Error("invalid_input", "Invalid LM2 benchmark candidate score.");
      }
      const tokenCount = Math.ceil(candidate.text.length / 4);
      if (usedTokens + tokenCount > _input.tokenBudget) {
        omitted.push({ id: candidate.id, reason: "omitted_budget" });
        continue;
      }
      usedTokens += tokenCount;
      items.push({ type: "text", value: candidate.text, observationId: candidate.id });
      selected.push({ id: candidate.id, score, tokenCount });
    }
    return { items, receipt: { selected, omitted, candidateCount: candidates.length } };
  }
}
