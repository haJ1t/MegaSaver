const NOISE =
  /^(?:Progress: resolved \d|reify:|idealTree:|timing |npm timing |npm http fetch |[+.]{8,}$)/;

// Spinner/progress repaints are terminal decoration; the LAST Progress line
// carries the final totals, so it is re-kept and excluded from the count.
export function compressNpmInstall(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let dropped = 0;
  let lastProgress: string | undefined;
  for (const line of lines) {
    if (NOISE.test(line)) {
      if (line.startsWith("Progress: ")) lastProgress = line;
      dropped += 1;
      continue;
    }
    out.push(line);
  }
  if (lastProgress !== undefined) {
    out.push(lastProgress);
    dropped -= 1;
  }
  if (dropped > 0) out.push(`… [${dropped} progress lines]`);
  return out.join("\n");
}
