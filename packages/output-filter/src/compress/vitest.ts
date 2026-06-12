import { collapseRepeatedLines } from "../normalize.js";

// Passing test lines (vitest "✓"/"√" reporter rows). Everything else —
// failing tests, assertion messages, stack frames, the Test
// Files/Tests/Duration summary — is signal and kept.
const PASSING = /^\s*[✓√]\s/;

export function compressVitest(text: string): string {
  const out: string[] = [];
  let passRun = 0;
  const flush = () => {
    if (passRun > 0) {
      out.push(`  … [${passRun} passing collapsed]`);
      passRun = 0;
    }
  };
  for (const line of text.split("\n")) {
    if (PASSING.test(line)) {
      passRun += 1;
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return collapseRepeatedLines(out.join("\n"));
}
