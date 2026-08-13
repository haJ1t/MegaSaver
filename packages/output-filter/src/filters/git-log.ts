const ONELINE = /^[0-9a-f]{7,40} \S/;
const HEAD_KEEP = 15;
const TAIL_KEEP = 5;

// Only the oneline shape collapses (recent commits + the oldest tail are the
// evidence an agent acts on); full-format logs pass through verbatim.
export function compressGitLog(text: string): string {
  const lines = text.split("\n");
  const trailing = text.endsWith("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= HEAD_KEEP + TAIL_KEEP + 1) return text;
  if (!lines.every((l) => l === "" || ONELINE.test(l))) return text;
  const dropped = lines.length - HEAD_KEEP - TAIL_KEEP;
  return (
    [
      ...lines.slice(0, HEAD_KEEP),
      `… [${dropped} commits omitted]`,
      ...lines.slice(lines.length - TAIL_KEEP),
    ].join("\n") + (trailing ? "\n" : "")
  );
}
