import { rankBm25 } from "@megasaver/retrieval";
import {
  type Observation,
  type RecallBundle,
  type RecallRequest,
  observationSchema,
  recallRequestSchema,
} from "./model.js";

export type LongMemoryStore = {
  insert(observation: Observation): { inserted: boolean };
  query(request: RecallRequest): RecallBundle;
};

export function createInMemoryLongMemoryStore(): LongMemoryStore {
  const observationsByWorkspace = new Map<
    string,
    { observationsByDigest: Map<string, Observation>; sourceDigestById: Map<string, string> }
  >();

  return {
    insert(observation) {
      const parsedObservation = observationSchema.parse(observation);
      const workspace = observationsByWorkspace.get(parsedObservation.workspaceKey) ?? {
        observationsByDigest: new Map(),
        sourceDigestById: new Map(),
      };
      if (workspace.observationsByDigest.has(parsedObservation.sourceDigest)) {
        return { inserted: false };
      }
      if (workspace.sourceDigestById.has(parsedObservation.id)) {
        throw new Error("Observation id already exists in workspace");
      }
      workspace.observationsByDigest.set(parsedObservation.sourceDigest, parsedObservation);
      workspace.sourceDigestById.set(parsedObservation.id, parsedObservation.sourceDigest);
      observationsByWorkspace.set(parsedObservation.workspaceKey, workspace);
      return { inserted: true };
    },
    query(request) {
      const parsedRequest = recallRequestSchema.parse(request);
      const observations = [
        ...(observationsByWorkspace
          .get(parsedRequest.workspaceKey)
          ?.observationsByDigest.values() ?? []),
      ];
      const byId = new Map(observations.map((observation) => [observation.id, observation]));
      const ranked = rankBm25({
        query: parsedRequest.task,
        documents: observations.map((observation) => ({
          id: observation.id,
          text: observation.text,
        })),
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
        if (usedTokens + tokenEstimate > parsedRequest.tokenBudget) continue;
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
