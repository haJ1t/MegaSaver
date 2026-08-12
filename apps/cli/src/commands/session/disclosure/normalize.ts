import { redact } from "@megasaver/policy";

const LINE_COL_SUFFIX = /:\d{1,6}(?::\d{1,6})?$/;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:\//;

export function normalizeClaimedPath(raw: string, cwd: string): string | null {
  let p = raw.trim();
  if (
    p.length >= 2 &&
    ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))
  ) {
    p = p.slice(1, -1);
  }
  p = p.replace(LINE_COL_SUFFIX, "").replaceAll("\\", "/");
  const cwdPosix = cwd.replaceAll("\\", "/").replace(/\/{1,4}$/, "");
  if (p.startsWith(`${cwdPosix}/`)) p = p.slice(cwdPosix.length + 1);
  else if (p.startsWith("/") || WINDOWS_ABSOLUTE.test(p)) return null;
  while (p.startsWith("./")) p = p.slice(2);
  if (p === "" || p.length > 512 || /\s/.test(p)) return null;
  for (const segment of p.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return null;
  }
  if (redact(p).count > 0) return null;
  return p;
}
