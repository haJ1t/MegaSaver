export const MAX_FAILURES_INPUT_BYTES = 8_388_608;

// Decision 9: one linear scanning regex for chunk ids (fixed head, bounded hex
// run, \b fences); paths are tokenized and validated PER TOKEN with anchored
// bounded patterns — no scanning regex over the whole input.
const CHUNK_REF = /\bcs-[0-9a-f]{8,64}\b/g;
const TOKEN_SPLIT = /[\s"'`()<>,;]+/;
const TRAILING_PUNCT = /[.:]+$/;
const SLASH_PATH = /^\.{0,2}\/?[\w.@-]+(?:\/[\w.@-]+)+$/;
const DOTTED_FILE = /^[\w@-]+\.[A-Za-z0-9]{2,8}$/;
const MAX_TOKEN_LENGTH = 512;
const MAX_SCANNED_REFS = 4_096;

export type ScannedRefs = { chunkRefs: readonly string[]; pathRefs: readonly string[] };

export function scanRefs(text: string): ScannedRefs {
  const chunkRefs: string[] = [];
  const seenChunk = new Set<string>();
  for (const match of text.matchAll(CHUNK_REF)) {
    if (chunkRefs.length >= MAX_SCANNED_REFS) break;
    const id = match[0];
    if (!seenChunk.has(id)) {
      seenChunk.add(id);
      chunkRefs.push(id);
    }
  }
  const pathRefs: string[] = [];
  const seenPath = new Set<string>();
  for (const rawToken of text.split(TOKEN_SPLIT)) {
    if (pathRefs.length >= MAX_SCANNED_REFS) break;
    if (rawToken.length === 0 || rawToken.length > MAX_TOKEN_LENGTH) continue;
    const token = rawToken.replace(TRAILING_PUNCT, "");
    if (!SLASH_PATH.test(token) && !DOTTED_FILE.test(token)) continue;
    if (!seenPath.has(token)) {
      seenPath.add(token);
      pathRefs.push(token);
    }
  }
  return { chunkRefs, pathRefs };
}
