export function canonicalizeFilePath(s: string): string {
  let out = s.trim();
  // Strip wrapping backticks or quotes added by authors.
  if (
    (out.startsWith("`") && out.endsWith("`")) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith('"') && out.endsWith('"'))
  ) {
    out = out.slice(1, -1).trim();
  }
  // Strip line number suffix including ranges (ASCII hyphen or en-dash).
  out = out.replace(/:\d+(?:[-–]\d+)?$/, "").trim();
  // Canonicalize leading ./
  if (out.startsWith("./")) out = out.slice(2);
  return out;
}
