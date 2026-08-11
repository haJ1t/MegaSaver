export type Hotspot = {
  filePath: string;
  bytes: number;
  tokens: number;
  score: number;
  keepRate: number;
};

export function computeHotspots(input: {
  blocks: { filePath: string; bytes: number }[];
  counters?: Map<string, { kept: number; dropped: number }>;
}): Hotspot[] {
  const hotspots: Hotspot[] = [];
  for (const b of input.blocks) {
    const tokens = Math.ceil(b.bytes / 4);
    const c = input.counters?.get(b.filePath);
    const kept = c?.kept ?? 1;
    const dropped = c?.dropped ?? 0;
    const total = kept + dropped;
    const dropRate = total > 0 ? dropped / total : 0;
    const keepRate = total > 0 ? kept / total : 1;
    const score = tokens * (1 + dropRate * 0.5);
    hotspots.push({ filePath: b.filePath, bytes: b.bytes, tokens, score, keepRate });
  }
  hotspots.sort((a, b) => b.score - a.score || b.tokens - a.tokens || a.filePath.localeCompare(b.filePath));
  return hotspots;
}
