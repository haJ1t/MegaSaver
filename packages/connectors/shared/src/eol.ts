// Drift comparison normalizes EOLs so a file whose halves merely disagree
// on line ending (common on Windows: git autocrlf, CRLF editors) is not
// misreported as drift. Only \r\n is collapsed; a lone \r is left as-is.
export function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}
