import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CandidateCatalog } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import { type Lm2Candidate, MAX_LM2_CANDIDATE_CORPUS_UTF8_BYTES } from "./lm2-model.js";

const MAX_CANDIDATES = 10_000;

export type Lm2RuntimeCandidates = {
  candidates: readonly Lm2Candidate[];
  omittedByCorpusLimit: number;
};

export function loadLm2RuntimeCandidates(input: {
  workspaceKey: string;
  catalog: Lm2CandidateCatalog;
  store: FileLm1Store;
}): Lm2RuntimeCandidates {
  const page = input.catalog.page({
    workspaceKey: input.workspaceKey,
    cursor: null,
    limit: MAX_CANDIDATES,
  });
  if (page.nextCursor !== null || input.store.getByIds === undefined) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog cannot be resolved.");
  }
  const records = input.store.getByIds(
    input.workspaceKey,
    page.entries.map(({ id, kind, sourceDigest }) => ({ id, kind, sourceDigest })),
    MAX_CANDIDATES,
  );
  if (records.length !== page.entries.length) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog is incomplete.");
  }
  const ordered = records
    .map((record) => ({
      id: record.id,
      workspaceKey: record.workspaceKey,
      observedAt: record.observedAt,
      kind: record.kind,
      text: record.text,
      sourceDigest: record.sourceDigest,
    }))
    .sort(
      (left, right) =>
        right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id),
    );
  const candidates: Lm2Candidate[] = [];
  let bytes = 0;
  for (const candidate of ordered) {
    const next = bytes + Buffer.byteLength(candidate.text, "utf8");
    if (!Number.isSafeInteger(next) || next > MAX_LM2_CANDIDATE_CORPUS_UTF8_BYTES) break;
    bytes = next;
    candidates.push(candidate);
  }
  return {
    candidates,
    omittedByCorpusLimit: ordered.length - candidates.length,
  };
}
