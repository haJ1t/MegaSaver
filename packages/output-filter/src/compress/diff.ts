// Diff structural lines that are always signal: per-file headers, hunk
// headers, and rename/mode metadata.
const HEADER =
  /^(diff --git |index |--- |\+\+\+ |@@ |rename |new file |deleted file |old mode |new mode |similarity )/;
// A changed line in a unified diff (but not the +++/--- file headers).
const CHANGED = /^[+-](?![+-]{2} )/;
// git log/show graph decoration: a line made up of NOTHING but
// │ * | \ / _ and spaces (a pure spine, no payload). Lines that also
// carry content — the stat summary " file | N ++--", a "N files changed"
// footer, or a "| * <sha> <subject>" graph content line — do not match
// and are preserved.
const GRAPH = /^[\s|*\\/_]+$/;

// Unified diff: keep headers + every +/- line, reduce each unchanged
// context block to 1 line on each side of a change, collapse the dropped
// middle to a marker. git status/log --stat: keep every content line and
// collapse only pure graph-spine runs to a counted marker. Both paths emit
// a marker for anything collapsed, so distinct data items are never
// silently dropped; only redundant context/decoration is trimmed.
export function compressDiff(text: string): string {
  const lines = text.split("\n");
  // A trailing newline is a line terminator, not a context line; the
  // empty tail element it leaves behind would otherwise be collapsed and
  // inflate the final "[N unchanged]" marker by one.
  if (lines.at(-1) === "") lines.pop();
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

// Drop ONLY pure graph-spine lines (the GRAPH regex: nothing but
// │ * | \ / _ and spaces). Any line carrying content — a stat summary,
// a commit subject with a literal '|', or a "| * <sha> <subject>" graph
// content line — is preserved. Collapsed spines become a counted marker
// so no data item is silently dropped (evidence preservation).
function compressStat(lines: string[]): string {
  const out: string[] = [];
  let spine = 0;
  for (const line of lines) {
    if (GRAPH.test(line)) {
      spine += 1;
      continue;
    }
    if (spine > 0) {
      out.push(`… [${spine} graph]`);
      spine = 0;
    }
    out.push(line);
  }
  if (spine > 0) out.push(`… [${spine} graph]`);
  return out.join("\n");
}
