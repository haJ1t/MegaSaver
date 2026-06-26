import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHOWN_INDEX_FILENAME, atomicWriteFile } from "@megasaver/content-store";

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
