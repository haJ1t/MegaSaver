import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN_INDEX_FILENAME, atomicWriteFile } from "@megasaver/content-store";
import type { FilterOutputResult, OutputExcerpt } from "@megasaver/output-filter";
import { hashContent } from "./read-index.js";

export type ShownIndexEntry = { chunkSetId: string };
type ShownIndex = Record<string, ShownIndexEntry>;

export function shownIndexPath(sessionDir: string): string {
  return join(sessionDir, SHOWN_INDEX_FILENAME);
}

export function loadShownIndex(sessionDir: string): ShownIndex {
  let raw: string;
  try {
    raw = readFileSync(shownIndexPath(sessionDir), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ShownIndex;
  } catch {
    return {};
  }
}

// ponytail: load-modify-write, last-writer-wins under parallel same-session calls.
// Fail-open by design: a row dropped by a concurrent overwrite only costs a later
// dedup miss (the text is re-shown once), never a false suppression or evidence
// loss. Upgrade to a per-session file lock only if same-session concurrency proves
// to drop rows in practice.
export function recordShown(
  sessionDir: string,
  entries: ReadonlyArray<{ textHash: string; chunkSetId: string }>,
): void {
  if (entries.length === 0) return;
  const index = loadShownIndex(sessionDir);
  for (const { textHash, chunkSetId } of entries) {
    if (index[textHash] === undefined) {
      index[textHash] = { chunkSetId };
    }
  }
  try {
    atomicWriteFile(shownIndexPath(sessionDir), `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    // best-effort: a failed record just means the next occurrence is a dedup miss.
  }
}

export function dedupShownExcerpts(input: {
  sessionDir: string;
  currentChunkSetId: string;
  excerpts: readonly OutputExcerpt[];
}): {
  excerpts: OutputExcerpt[];
  suppressed: number;
  priorChunkSetIds: string[];
  recordEntries: { textHash: string; chunkSetId: string }[];
} {
  const index = loadShownIndex(input.sessionDir);
  const seenThisBatch = new Set<string>();
  const kept: OutputExcerpt[] = [];
  const recordEntries: { textHash: string; chunkSetId: string }[] = [];
  const priorChunkSetIds: string[] = [];
  let suppressed = 0;

  const pushDistinct = (id: string): void => {
    if (!priorChunkSetIds.includes(id)) priorChunkSetIds.push(id);
  };

  for (const excerpt of input.excerpts) {
    const h = hashContent(excerpt.text);
    const row = index[h];
    const priorId =
      row !== undefined && typeof row.chunkSetId === "string" && row.chunkSetId.length > 0
        ? row.chunkSetId
        : undefined;
    if (priorId !== undefined) {
      suppressed++;
      pushDistinct(priorId);
      continue;
    }
    if (seenThisBatch.has(h)) {
      suppressed++;
      pushDistinct(input.currentChunkSetId);
      continue;
    }
    seenThisBatch.add(h);
    kept.push(excerpt);
    recordEntries.push({ textHash: h, chunkSetId: input.currentChunkSetId });
  }

  return { excerpts: kept, suppressed, priorChunkSetIds, recordEntries };
}

// Best-effort shown-dedup applied AFTER the chunk-set is persisted: drop excerpts
// whose text was already shown earlier this session, annotate the summary, and
// record the kept text so future reads dedup against it. Shared by all four
// output pipelines (registry/overlay × read/exec); never throws.
export function applyShownDedup<T extends FilterOutputResult>(input: {
  result: T;
  sessionDir: string;
  chunkSetId: string;
}): T {
  const dd = dedupShownExcerpts({
    sessionDir: input.sessionDir,
    currentChunkSetId: input.chunkSetId,
    excerpts: input.result.excerpts,
  });
  const result =
    dd.suppressed > 0
      ? {
          ...input.result,
          excerpts: dd.excerpts,
          summary: `${input.result.summary} (${dd.suppressed} chunk(s) already shown earlier this session — expand ${dd.priorChunkSetIds.join(", ")} to view)`,
          deduped: { suppressed: dd.suppressed, priorChunkSetIds: dd.priorChunkSetIds },
        }
      : { ...input.result, excerpts: dd.excerpts };
  recordShown(input.sessionDir, dd.recordEntries);
  return result;
}
