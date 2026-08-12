export const MAX_DISCLOSURE_INPUT_BYTES = 8_388_608;
export const MAX_CLAIMED_PATHS = 512;

export type ClaimMatchKind = "backtick" | "diff-header" | "bare";
export type ClaimedPath = { path: string; matchKind: ClaimMatchKind };

const BACKTICK_SPAN = /`([^`\n]{1,256})`/g;
const DIFF_HEADER =
  /^(?:diff --git a\/(\S{1,512}) b\/\S{1,512}|\+\+\+ b\/(\S{1,512})|--- a\/(\S{1,512}))$/gm;
// Non-global twin of DIFF_HEADER: diff-header lines are excluded from the
// bare scan, or `a/<path>` / `b/<path>` would leak in as extra bare claims.
const DIFF_LINE = /^(?:diff --git a\/\S{1,512} b\/\S{1,512}|\+\+\+ b\/\S{1,512}|--- a\/\S{1,512})$/;
const BARE_PATH = /(?<![\w.@/-])(?:[\w.@-]{1,64}\/){1,8}[\w.@-]{1,64}(?![\w.@/-])/g;
const FILENAME_SHAPE = /^[\w@-][\w.@-]{0,63}\.[A-Za-z0-9]{1,12}$/;

function backtickCandidateIsPath(span: string): boolean {
  if (/\s/.test(span)) return false;
  return span.includes("/") || FILENAME_SHAPE.test(span);
}

export function extractClaimedPaths(text: string): ClaimedPath[] {
  const seen = new Map<string, ClaimMatchKind>();
  const add = (path: string, matchKind: ClaimMatchKind): boolean => {
    if (seen.size >= MAX_CLAIMED_PATHS) return false;
    if (!seen.has(path)) seen.set(path, matchKind);
    return true;
  };
  for (const m of text.matchAll(BACKTICK_SPAN)) {
    const span = m[1];
    if (span !== undefined && backtickCandidateIsPath(span) && !add(span, "backtick")) break;
  }
  for (const m of text.matchAll(DIFF_HEADER)) {
    const path = m[1] ?? m[2] ?? m[3];
    if (path !== undefined && !add(path, "diff-header")) break;
  }
  const bareSource = text
    .split("\n")
    .filter((line) => !DIFF_LINE.test(line))
    .join("\n");
  for (const m of bareSource.matchAll(BARE_PATH)) {
    if (!add(m[0], "bare")) break;
  }
  return [...seen].map(([path, matchKind]) => ({ path, matchKind }));
}
