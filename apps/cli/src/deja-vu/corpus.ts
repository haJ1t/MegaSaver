export type CorpusEntry = {
  id: string;
  text: string;
  workspaceKey: string;
  path?: string;
};

export function loadDejaVuCorpus(storeRoot: string): CorpusEntry[] {
  // Minimal stub: return empty corpus; real would scan content-store + memory
  return [];
}

export function searchDejaVu(
  corpus: CorpusEntry[],
  query: string,
): { id: string; score: number }[] {
  const q = query.toLowerCase();
  return corpus
    .map((e) => ({ id: e.id, score: e.text.toLowerCase().includes(q) ? 1 : 0 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
