// ASSUMPTION: piped `gh pr list` emits header-less TSV rows starting
// `<number>\t` — gh v2 behavior; a wrong assumption degrades to the safe
// no-op (spec open question 3).
const ROW = /^\d+\t/;
const MAX_ROWS = 30;

export function compressGhPrList(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= MAX_ROWS) return text;
  if (!lines.every((l) => l === "" || ROW.test(l))) return text;
  const trailing = text.endsWith("\n");
  const dropped = lines.length - MAX_ROWS;
  return (
    [...lines.slice(0, MAX_ROWS), `… [${dropped} more PRs]`].join("\n") + (trailing ? "\n" : "")
  );
}
