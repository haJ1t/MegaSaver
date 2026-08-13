const NOISE =
  /^#\d{1,4} (?:sha256:[0-9a-f]{8,64}|extracting sha256:|transferring (?:context|dockerfile):|loading metadata for )/;

// BuildKit layer transfer/extract repaints are decoration; step headers,
// CACHED/DONE/ERROR lines, in-step run output and the final image lines are
// the evidence and pass through untouched.
export function compressDockerBuild(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let layers = 0;
  for (const line of lines) {
    if (NOISE.test(line)) {
      layers += 1;
      continue;
    }
    out.push(line);
  }
  if (layers > 0) out.push(`… [${layers} layer lines]`);
  return out.join("\n");
}
