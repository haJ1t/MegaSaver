const NOISE =
  /^(?:Progress: resolved \d|reify:|idealTree:|timing |npm timing |npm http fetch |[+.]{8,}$)/;
// Only install-shaped output is eligible: the command label can match this
// filter from inside a composite command (docker run … "yarn install"), and
// dropping lines from that output would be a wrong ownership. Progress lines
// are the pnpm/npm spinner repaints; their presence is the shape.
const SHAPE = /^(?:Progress: resolved \d|reify:|idealTree:)/;

// Spinner/progress repaints are terminal decoration; the LAST Progress line
// carries the final totals, so it is re-kept and excluded from the count.
export function compressNpmInstall(text: string): string {
  const lines = text.split("\n");
  const trailing = text.endsWith("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.some((l) => SHAPE.test(l))) return text;
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
  return out.join("\n") + (trailing ? "\n" : "");
}
