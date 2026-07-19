import { rankBm25 } from "@megasaver/retrieval";
import type { Observation, RecallBundle, RecallRequest } from "./model.js";

export type LongMemoryStore = {
  insert(observation: Observation): { inserted: boolean };
  query(request: RecallRequest): RecallBundle;
};

export function createInMemoryLongMemoryStore(): LongMemoryStore {
  const observationsByWorkspace = new Map<string, Map<string, Observation>>();

  return {
    insert(observation) {
      const observations = observationsByWorkspace.get(observation.workspaceKey) ?? new Map();
      if (observations.has(observation.sourceDigest)) return { inserted: false };
      observations.set(observation.sourceDigest, observation);
      observationsByWorkspace.set(observation.workspaceKey, observations);
      return { inserted: true };
    },
    query(request) {
      const observations = [...(observationsByWorkspace.get(request.workspaceKey)?.values() ?? [])];
      const byId = new Map(observations.map((observation) => [observation.id, observation]));
      const ranked = rankBm25({
        query: request.task,
        documents: observations.map((observation) => ({ id: observation.id, text: observation.text })),
        topN: observations.length || 1,
      });
      let usedTokens = 0;
      const items: RecallBundle["items"] = [];
      const receipt: RecallBundle["receipt"] = [];
      for (const hit of ranked) {
        if (hit.score <= 0) continue;
        const observation = byId.get(hit.id);
        if (observation === undefined) continue;
        const tokenEstimate = Math.ceil(observation.text.length / 4);
        if (usedTokens + tokenEstimate > request.tokenBudget) continue;
        usedTokens += tokenEstimate;
        items.push({ type: "text", value: observation.text, observationId: observation.id });
        receipt.push({
          observationId: observation.id,
          evidenceIds: observation.evidenceIds,
          lane: "state",
          tokenEstimate,
        });
      }
      return { items, receipt };
    },
  };
}
