import type { MemoryEntry } from "./memory-entry.js";

// The files an approved, non-stale memory points at, deduped and order-stable.
// Feeds the context-pruner's `memoryRelevance` factor. We use ALL approved
// non-stale memories — NOT a BM25-narrowed subset — so a memory whose prose does
// not lexically match the task still contributes its relatedFiles to the signal
// (the gap a `searchMemoryEntries({ text })`-derived list silently dropped).
function relatedFilesWhere(
  entries: readonly MemoryEntry[],
  predicate: (entry: MemoryEntry) => boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    for (const file of entry.relatedFiles ?? []) {
      if (!seen.has(file)) {
        seen.add(file);
        out.push(file);
      }
    }
  }
  return out;
}

export function approvedMemoryFiles(entries: readonly MemoryEntry[]): string[] {
  return relatedFilesWhere(entries, (e) => e.approval === "approved" && !e.stale);
}

// Approved STALE memories' files — the pruner's stale-penalty signal.
export function staleMemoryFiles(entries: readonly MemoryEntry[]): string[] {
  return relatedFilesWhere(entries, (e) => e.approval === "approved" && e.stale);
}
