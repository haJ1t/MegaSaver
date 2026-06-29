// Diff structural lines that are always signal: per-file headers, hunk
// headers, and rename/mode metadata.
const HEADER =
  /^(diff --git |index |--- |\+\+\+ |@@ |rename |new file |deleted file |old mode |new mode |similarity )/;
// A changed line in a unified diff (but not the +++/--- file headers).
const CHANGED = /^[+-](?![+-]{2} )/;
// git log/show graph decoration: a leading run of │ * | \ / _ and spaces
// with no file/stat payload. The stat summary (" file | N ++--") and the
// "N files changed" footer are kept; bare graph spines are dropped.
const GRAPH = /^[\s|*\\/_]+$/;
const STAT = /\|\s+\d+\s+[+-]|files? changed|insertions?\(\+\)|deletions?\(-\)/;

// Unified diff: keep headers + every +/- line, reduce each unchanged
// context block to 1 line on each side of a change, collapse the dropped
// middle to a marker. git status/log --stat: keep the file/stat summary,
// drop decorative graph spine lines. Lossless — raw output persists to
// the ChunkSet; this only trims what is RETURNED.
export function compressDiff(text: string): string {
  const lines = text.split("\n");
  const hasHunk = lines.some((l) => l.startsWith("@@ "));
  if (!hasHunk) return compressStat(lines);

  const out: string[] = [];
  let ctx: string[] = [];
  let pendingLead = false;

  const flushContext = (atHunkEnd: boolean) => {
    // One line after the previous change (if we are mid-hunk), the
    // collapse marker for the dropped middle, then one line before the
    // next change. At a hunk/file boundary there is no "next change", so
    // only the trailing context line is kept.
    const trail = pendingLead && ctx.length > 0 ? [ctx[0] as string] : [];
    const lead =
      !atHunkEnd && ctx.length > (trail.length > 0 ? 1 : 0) ? [ctx[ctx.length - 1] as string] : [];
    const shown = trail.length + lead.length;
    const dropped = ctx.length - shown;
    out.push(...trail);
    if (dropped > 0) out.push(`… [${dropped} unchanged]`);
    out.push(...lead);
    ctx = [];
    pendingLead = false;
  };

  for (const line of lines) {
    if (HEADER.test(line)) {
      flushContext(true);
      out.push(line);
      pendingLead = false;
      continue;
    }
    if (CHANGED.test(line)) {
      flushContext(false);
      out.push(line);
      pendingLead = true;
      continue;
    }
    ctx.push(line);
  }
  flushContext(true);
  return out.join("\n");
}

function compressStat(lines: string[]): string {
  return lines.filter((l) => !GRAPH.test(l) && (STAT.test(l) || !l.includes("|"))).join("\n");
}
