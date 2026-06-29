// Git-history co-change signal. Pure / no-I/O: the caller shells out
// `git log --numstat` once and hands the raw text here. `parseNumstat` turns it
// into per-file co-change frequencies + churn; `coChangeStrength` scores how
// strongly a file co-evolves with the edit-site (`changedFiles`) set, 0..1.

export type CoChangeMap = {
  // fileA -> (fileB -> # of commits touching both)
  coChange: Map<string, Map<string, number>>;
  // file -> total added+deleted lines across history
  churn: Map<string, number>;
  // strongest co-change frequency anywhere — the normalizer for strength.
  peak: number;
};

// `<added>\t<deleted>\t<path>`. Binary rows use `-` for the counts; skip them.
function parseRow(line: string): { path: string; churn: number } | undefined {
  const cols = line.split("\t");
  if (cols.length < 3) return undefined;
  const [added, deleted, ...rest] = cols;
  const path = rest.join("\t").trim();
  if (path === "") return undefined;
  if (added === "-" || deleted === "-") return undefined;
  const a = Number.parseInt(added ?? "", 10);
  const d = Number.parseInt(deleted ?? "", 10);
  if (Number.isNaN(a) || Number.isNaN(d)) return undefined;
  return { path, churn: a + d };
}

function bump(outer: Map<string, Map<string, number>>, key: string, other: string): void {
  let inner = outer.get(key);
  if (inner === undefined) {
    inner = new Map();
    outer.set(key, inner);
  }
  inner.set(other, (inner.get(other) ?? 0) + 1);
}

// `git log --numstat` prints a header block per commit followed by numstat rows;
// commits are blank-line separated. We don't need commit boundaries to be exact
// — only "which files share a commit" — so we split on blank lines and treat
// each chunk's parseable rows as one co-changing set.
export function parseNumstat(raw: string): CoChangeMap {
  const coChange = new Map<string, Map<string, number>>();
  const churn = new Map<string, number>();

  for (const chunk of raw.split(/\n[ \t]*\n/)) {
    const files: string[] = [];
    for (const line of chunk.split("\n")) {
      const row = parseRow(line);
      if (row === undefined) continue;
      files.push(row.path);
      churn.set(row.path, (churn.get(row.path) ?? 0) + row.churn);
    }
    const unique = [...new Set(files)];
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const a = unique[i] as string;
        const b = unique[j] as string;
        bump(coChange, a, b);
        bump(coChange, b, a);
      }
    }
  }

  let peak = 0;
  for (const partners of coChange.values()) {
    for (const freq of partners.values()) peak = Math.max(peak, freq);
  }

  return { coChange, churn, peak };
}

// Strength = (max co-change frequency between `filePath` and any edit-site file)
// normalized by the map's global peak frequency — same top-normalized spirit as
// semanticRelevance, so a file that co-changes 3x with the edit site outranks
// one that co-changes once. Yields 0..1, is 0 when there is no history, no
// changedFiles, or no shared commit with the edit site. Self-pairs (a changed
// file scoring against itself) are ignored — recentEdit covers the edit site.
export function coChangeStrength(
  map: CoChangeMap,
  filePath: string,
  changedFiles: readonly string[],
): number {
  const partners = map.coChange.get(filePath);
  if (partners === undefined || changedFiles.length === 0 || map.peak === 0) return 0;

  let hits = 0;
  for (const changed of changedFiles) {
    if (changed === filePath) continue;
    hits = Math.max(hits, partners.get(changed) ?? 0);
  }
  return hits / map.peak;
}
