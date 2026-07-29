// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars by definition.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// The per-line strip is trimEnd, NOT /\s+$/. That regex is an unbounded greedy
// run before a required anchor, so on a whitespace run that is not at
// end-of-line every offset scans to the run's end, fails `$` and backtracks —
// quadratic in line length (13.8 s on a 200 KB run). This is the first
// structural pass over every raw tool output and file read, ahead of any size
// cap. trimEnd strips the identical character set (ES `\s` is WhiteSpace plus
// LineTerminator, exactly what trimEnd removes) in linear time. Do not restore
// the regex.
export function normalize(raw: string): string {
  return raw
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

// A3 (spec 2026-07-28 §W3): where each surviving line came from in the RAW
// output, 1-based and inclusive. The collapse passes fold consecutive runs, so
// output line k stands for a contiguous raw span — that span is the only thing
// that lets a delivered line number be expressed in the coordinate system the
// stored chunks actually index (and that the agent reads its file in).
export type LineSpan = { start: number; end: number };

export function identitySpans(text: string): LineSpan[] {
  return text.split("\n").map((_, i) => ({ start: i + 1, end: i + 1 }));
}

export function collapseRepeatedLinesTraced(
  text: string,
  spans: readonly LineSpan[],
): { text: string; spans: LineSpan[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const outSpans: LineSpan[] = [];
  const spanAt = (i: number): LineSpan => spans[i] ?? { start: i + 1, end: i + 1 };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;
    out.push(line);
    outSpans.push(spanAt(i));
    if (run >= 2) {
      out.push(`… [repeated ${run} times]`);
      // The marker stands for the WHOLE run, first occurrence included: it is
      // the only delivered token that accounts for the folded lines.
      outSpans.push({ start: spanAt(i).start, end: spanAt(i + run - 1).end });
    }
    i += run;
  }
  return { text: out.join("\n"), spans: outSpans };
}

export function collapseRepeatedLines(text: string): string {
  return collapseRepeatedLinesTraced(text, identitySpans(text)).text;
}

// Evidence guard (§12 HIGH): a line carrying any diagnostic signal is never
// folded — two such lines may be distinct events an agent must see.
const DIAGNOSTIC = /\b(error|fail(?:ed|ure)?|exception|warn(?:ing)?|panic|fatal)\b|\bTS\d+\b/i;
// A real source position is structural evidence, not volatile noise. It must be
// a path/filename token (starts with a letter) followed by :line:col — NOT a
// bare wall-clock HH:MM:SS, which starts with a digit and is masked by <ts>.
// Bounded run: unbounded, this is quadratic on a long delimiter-free line
// (7.4 s on 50 KB) because the class accepts the whole run and `:` never
// follows. No real source path is 256 chars. Do not restore `*`.
const POSITION = /[A-Za-z][\w./-]{0,256}:\d+:\d+/;

// Volatile tokens masked to a placeholder before similarity comparison. Only
// pure identity noise — timestamps, uuids, hex ids, request-id ports — is
// masked. Duration/byte/decimal-number masks were removed (review HIGH): those
// values ARE the distinguishing signal (a 9000ms slow request, a 4096 B write,
// a distinct account id) and the design's ChunkSet recovery net does not exist
// in this repo, so folding them is non-recoverable evidence loss. The hex mask
// requires at least one a-f letter so pure-decimal ids never match. Order
// matters: timestamps before the rest so the longer match wins.
const MASKS: Array<[RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>"],
  [/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<ts>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // ponytail: hex and port masks removed — they folded distinct value-bearing events
  // (content hashes, fault addresses, bind ports). Only timestamps and UUIDs are
  // true identity noise with recoverable-enough signal to fold safely.
];

function maskTemplate(line: string): string {
  let t = line;
  for (const [re, sub] of MASKS) t = t.replace(re, sub);
  return t;
}

// Second normalize pass (runs after collapseRepeatedLines): fold a run of
// consecutive lines whose MASKED form is identical into FIRST + marker + LAST,
// preserving boundary evidence and the count. Conservative — see DIAGNOSTIC.
export function collapseSimilar(text: string): string {
  return collapseSimilarTraced(text, identitySpans(text)).text;
}

export function collapseSimilarTraced(
  text: string,
  spans: readonly LineSpan[],
): { text: string; spans: LineSpan[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const outSpans: LineSpan[] = [];
  const spanAt = (i: number): LineSpan => spans[i] ?? { start: i + 1, end: i + 1 };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const template = maskTemplate(line);
    // Guards run on the MASKED template so a masked timestamp's `T`-separator
    // (e.g. ...T10:00:01) cannot masquerade as a file:line:col position.
    if (DIAGNOSTIC.test(template) || POSITION.test(template)) {
      out.push(line);
      outSpans.push(spanAt(i));
      i += 1;
      continue;
    }
    // Only volatile-bearing lines (template differs from raw) are fold
    // candidates; otherwise collapseRepeatedLines already handled exact dupes.
    if (template === line) {
      out.push(line);
      outSpans.push(spanAt(i));
      i += 1;
      continue;
    }
    let run = 1;
    while (i + run < lines.length) {
      const next = lines[i + run] as string;
      const nextTemplate = maskTemplate(next);
      if (DIAGNOSTIC.test(nextTemplate) || POSITION.test(nextTemplate)) break;
      if (nextTemplate !== template) break;
      run += 1;
    }
    if (run >= 3) {
      out.push(line);
      outSpans.push(spanAt(i));
      out.push(`… [${run} similar: ${template}]`);
      // The marker stands for the folded middle only: first and last survive
      // verbatim and carry their own spans.
      outSpans.push({ start: spanAt(i + 1).start, end: spanAt(i + run - 2).end });
      out.push(lines[i + run - 1] as string);
      outSpans.push(spanAt(i + run - 1));
    } else {
      for (let k = 0; k < run; k += 1) {
        out.push(lines[i + k] as string);
        outSpans.push(spanAt(i + k));
      }
    }
    i += run;
  }
  return { text: out.join("\n"), spans: outSpans };
}
