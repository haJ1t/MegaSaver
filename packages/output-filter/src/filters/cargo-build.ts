const CRATE = /^ {1,8}(?:Compiling|Checking|Fresh|Downloaded|Downloading) \S/;
const WARNING = /^warning: /;
const MAX_CRATES = 3;

// Duplicate warning blocks come from multi-target builds (lib + bin + test
// re-emit the same diagnostic); the (header, location) pair identifies one.
// Markers are appended at the tail: counts are the contract, positions are
// presentation (single-pass simplicity). error[…] blocks never match WARNING
// and always pass through whole.
export function compressCargoBuild(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  const seen = new Set<string>();
  let crates = 0;
  let dupes = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (CRATE.test(line)) {
      crates += 1;
      if (crates <= MAX_CRATES) out.push(line);
      i += 1;
      continue;
    }
    if (WARNING.test(line)) {
      let end = i + 1;
      while (end < lines.length && (lines[end] as string).trim() !== "") end += 1;
      const key = `${line}\n${lines[i + 1] ?? ""}`;
      if (seen.has(key)) {
        dupes += 1;
      } else {
        seen.add(key);
        out.push(...lines.slice(i, end));
      }
      i = end;
      continue;
    }
    out.push(line);
    i += 1;
  }
  if (crates > MAX_CRATES) out.push(`… [${crates - MAX_CRATES} crates compiled]`);
  if (dupes > 0) out.push(`… [${dupes} duplicate warnings]`);
  return out.join("\n");
}
