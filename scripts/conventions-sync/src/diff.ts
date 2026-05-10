// computeDiff(before, after, label) — `before` is the "-" side, `after` is the "+" side.
export function computeDiff(before: string, after: string, label: string): string {
  if (before === after) return "";
  const expectedLines = before.split("\n");
  const actualLines = after.split("\n");
  const out: string[] = [];
  out.push(`--- ${label} (before)`);
  out.push(`+++ ${label} (after)`);
  const maxLen = Math.max(expectedLines.length, actualLines.length);
  let hunkStart = -1;
  const hunkLines: string[] = [];
  const flush = (): void => {
    if (hunkStart === -1) return;
    out.push(`@@ line ${hunkStart + 1} @@`);
    for (const line of hunkLines) out.push(line);
    hunkStart = -1;
    hunkLines.length = 0;
  };
  for (let i = 0; i < maxLen; i += 1) {
    const e = expectedLines[i];
    const a = actualLines[i];
    if (e === a) {
      if (hunkStart !== -1) {
        hunkLines.push(` ${e ?? ""}`);
        if (hunkLines.length > 6) flush();
      }
      continue;
    }
    if (hunkStart === -1) hunkStart = i;
    if (e !== undefined) hunkLines.push(`-${e}`);
    if (a !== undefined) hunkLines.push(`+${a}`);
  }
  flush();
  return out.join("\n");
}
