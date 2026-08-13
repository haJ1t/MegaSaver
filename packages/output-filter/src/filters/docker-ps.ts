const HEADER = /^CONTAINER ID\s{2,}IMAGE\s{2,}/;
const MAX_PER_IMAGE = 3;

// Consecutive same-image rows past the cap are replicas, not evidence; each
// distinct image (and any unsorted interleaving) is preserved.
export function compressDockerPs(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || !HEADER.test(lines[0] ?? "")) return text;
  const out: string[] = [lines[0] as string];
  let image = "";
  let kept = 0;
  let folded = 0;
  const flush = (): void => {
    if (folded > 0) out.push(`… [${folded} similar: ${image}]`);
    folded = 0;
  };
  for (const line of lines.slice(1)) {
    const img = line.split(/\s{2,}/)[1] ?? "";
    if (img !== image) {
      flush();
      image = img;
      kept = 0;
    }
    if (kept < MAX_PER_IMAGE) {
      out.push(line);
      kept += 1;
    } else {
      folded += 1;
    }
  }
  flush();
  return out.join("\n");
}
