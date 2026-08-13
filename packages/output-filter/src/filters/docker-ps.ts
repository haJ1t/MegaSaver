const HEADER = /^CONTAINER ID\s{2,}IMAGE\s{2,}/;
const MAX_PER_IMAGE = 3;
// A row that is not plainly healthy (status not starting with "Up") is the
// evidence an agent reads `docker ps` FOR — crashed/restarting containers
// never fold, matching the kubectl-get keep-every-anomaly doctrine.
const HEALTHY_STATUS = /^Up\b/;

// Consecutive same-image healthy rows past the cap are replicas, not
// evidence; each distinct image (and any unsorted interleaving) is preserved.
export function compressDockerPs(text: string): string {
  const lines = text.split("\n");
  const trailing = text.endsWith("\n");
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
    const parts = line.split(/\s{2,}/);
    const img = parts[1] ?? "";
    const status = parts[4] ?? "";
    // Rows without a recognized image column (or with an anomalous status)
    // pass through verbatim — they can never be folded into a similar-run.
    if (img === "" || !HEALTHY_STATUS.test(status)) {
      flush();
      image = "";
      out.push(line);
      continue;
    }
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
  return out.join("\n") + (trailing ? "\n" : "");
}
