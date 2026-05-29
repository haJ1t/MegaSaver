// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars by definition.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function normalize(raw: string): string {
  return raw
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

export function collapseRepeatedLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;
    out.push(line);
    if (run >= 2) out.push(`… [repeated ${run} times]`);
    i += run;
  }
  return out.join("\n");
}
