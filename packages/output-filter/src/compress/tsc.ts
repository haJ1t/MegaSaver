// tsc default: file(line,col): error TSxxxx: message
const ERR = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;
// tsc --pretty (after ANSI strip): file:line:col - error TSxxxx: message
const ERR_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.*)$/;
// Position-less diagnostics: global/config errors (error TS5023: Unknown
// compiler option …, error TS18002: no inputs were found, tsconfig errors).
const ERR_GLOBAL = /^error\s+TS\d+:/;
const FOUND = /^Found\s+\d+\s+errors?/;
const INDENTED = /^\s/;
// --pretty code-frame source lines are gutter-aligned, so a two-digit line
// number starts at column 0: `10 const a = …` right above the squiggle.
const CODE_FRAME = /^\d+\s/;

const HEADER_CAP = 10;
const omittedMarker = (n: number) =>
  `… [${n} non-diagnostic lines omitted — recoverable via stored chunks]`;

// Group distinct diagnostics by file and dedupe identical errors — but drop
// NOTHING silently (A1 save-integrity contract): position-less errors and the
// elaboration/code-frame lines attached to a diagnostic are kept verbatim;
// genuinely unrelated top-level lines are replaced by an exactly-counted
// marker naming what was removed and that it is recoverable. Continuations of
// a deduped duplicate error fold with it (their first copy is already kept).
export function compressTsc(text: string): string {
  const seen = new Set<string>();
  const byFile = new Map<string, string[]>();
  const order: string[] = [];
  const globalErrors: string[] = [];
  let found: string | undefined;
  let omitted = 0;
  // Bucket receiving continuation lines (indented elaborations, code frames,
  // blank separators). Null while inside a deduped duplicate's block.
  let attachTo: string[] | null = null;
  let blanks: string[] = [];

  for (const line of text.split("\n")) {
    const m = ERR.exec(line) ?? ERR_PRETTY.exec(line);
    if (m) {
      const [, file = "", ln = "", col = "", code = "", msg = ""] = m;
      const key = `${file}:${ln}:${col}:${code}:${msg}`;
      blanks = [];
      if (seen.has(key)) {
        attachTo = null;
        continue;
      }
      seen.add(key);
      const formatted = `${file}(${ln},${col}): error ${code}: ${msg}`;
      const bucket = byFile.get(file);
      if (bucket === undefined) {
        byFile.set(file, [formatted]);
        order.push(file);
        attachTo = byFile.get(file) ?? null;
      } else {
        bucket.push(formatted);
        attachTo = bucket;
      }
      continue;
    }
    const trimmed = line.trim();
    if (FOUND.test(trimmed)) {
      found = trimmed;
      attachTo = null;
      blanks = [];
      continue;
    }
    if (ERR_GLOBAL.test(trimmed)) {
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        globalErrors.push(trimmed);
        attachTo = globalErrors;
      } else {
        attachTo = null;
      }
      blanks = [];
      continue;
    }
    if (trimmed === "") {
      // Blank inside a diagnostic block: tentative separator, kept only when
      // more continuation follows. Top-level blanks carry no information and
      // are dropped uncounted.
      if (attachTo !== null) blanks.push(line);
      continue;
    }
    if (
      (INDENTED.test(line) || CODE_FRAME.test(line)) &&
      (attachTo !== null || blanks.length > 0)
    ) {
      if (attachTo !== null) {
        attachTo.push(...blanks, line);
      }
      blanks = [];
      continue;
    }
    // Top-level non-diagnostic content (npm/webpack chatter, misclassified
    // prose): counted, marked, never silently deleted.
    attachTo = null;
    blanks = [];
    omitted += 1;
  }

  const parts: string[] = [];
  const shown = order.slice(0, HEADER_CAP);
  const header = shown.map((f) => `${f} (${(byFile.get(f) ?? []).length})`).join(", ");
  const remainder = order.length - shown.length;
  if (header !== "") {
    parts.push(
      `Top files by error count: ${header}${remainder > 0 ? `, … and ${remainder} more files` : ""}`,
    );
  }
  for (const f of order) parts.push(...(byFile.get(f) ?? []));
  parts.push(...globalErrors);
  if (omitted > 0) parts.push(omittedMarker(omitted));
  if (found !== undefined) parts.push(found);
  return parts.join("\n");
}
