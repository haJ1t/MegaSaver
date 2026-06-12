// tsc default: file(line,col): error TSxxxx: message
const ERR = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;
// tsc --pretty (after ANSI strip): file:line:col - error TSxxxx: message
const ERR_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.*)$/;
const FOUND = /^Found\s+\d+\s+errors?/;

// Group distinct diagnostics by file, drop cascading non-error noise,
// dedupe identical errors, and lead with a top-files-by-error-count
// header. The "Found N errors" summary is preserved.
export function compressTsc(text: string): string {
  const seen = new Set<string>();
  const byFile = new Map<string, string[]>();
  const order: string[] = [];
  let found: string | undefined;

  for (const line of text.split("\n")) {
    const m = ERR.exec(line) ?? ERR_PRETTY.exec(line);
    if (m) {
      const [, file = "", ln = "", col = "", code = "", msg = ""] = m;
      const key = `${file}:${ln}:${col}:${code}:${msg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = byFile.get(file);
      if (bucket === undefined) {
        byFile.set(file, [`${file}(${ln},${col}): error ${code}: ${msg}`]);
        order.push(file);
      } else {
        bucket.push(`${file}(${ln},${col}): error ${code}: ${msg}`);
      }
      continue;
    }
    const trimmed = line.trim();
    if (FOUND.test(trimmed)) found = trimmed;
  }

  const parts: string[] = [];
  const header = order.map((f) => `${f} (${(byFile.get(f) ?? []).length})`).join(", ");
  if (header !== "") parts.push(`Top files by error count: ${header}`);
  for (const f of order) parts.push(...(byFile.get(f) ?? []));
  if (found !== undefined) parts.push(found);
  return parts.join("\n");
}
