import { z } from "zod";

export const yieldRowSchema = z
  .object({
    id: z.string(),
    injected: z.number().int().min(0),
    reusedAtLeast: z.number().int().min(0),
    // yield is a lower-bound ratio in 0..1
    yield: z.number().min(0).max(1),
    tier: z.enum(["HOT", "COLD", "FREELOADER"]),
    signals: z
      .object({
        readIndex: z.boolean(),
        decisionTrace: z.boolean(),
        diffFingerprint: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const yieldAuditReportSchema = z
  .object({
    version: z.literal(1),
    window: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .strict(),
    rows: z.array(yieldRowSchema),
    aggregatedRemaining: z.number().int().min(0),
    honestNote: z.string(),
    honestReceipt: z
      .object({
        warnings: z.array(z.string()),
      })
      .strict()
      .optional(),
  })
  .strict();

export type YieldRow = z.infer<typeof yieldRowSchema>;
export type YieldAuditReport = z.infer<typeof yieldAuditReportSchema>;

export type YieldAuditInput = {
  readonly injected: readonly {
    readonly id: string;
    readonly content: string;
    readonly relatedFiles?: readonly string[];
  }[];
  readonly evidence: readonly {
    readonly chunkSetId: string;
    readonly decisionTraceIds?: readonly string[];
    readonly relatedFilesInChunk?: readonly string[];
  }[];
  readonly readIndexEntries: readonly {
    readonly path: string;
    readonly sessionId: string;
    readonly at: string;
  }[];
  readonly diffAddedLines: readonly string[];
  readonly window: { readonly from: string; readonly to: string };
};

// closed tier contract: HOT ≥ 0.5, COLD 0.1–0.5, FREELOADER < 0.1
// tunable via this pure function; no schema change.
export function tierFor(yieldValue: number): YieldRow["tier"] {
  if (yieldValue >= 0.5) return "HOT";
  if (yieldValue >= 0.1) return "COLD";
  return "FREELOADER";
}

const IGNORE_RE = /(^|\/)(\.megasaver|node_modules|dist)\//;

function isIgnored(path: string): boolean {
  return (
    IGNORE_RE.test(path) ||
    path.startsWith(".megasaver/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("dist/")
  );
}

export function fingerprintMemory(content: string): readonly string[] {
  const slice = content.slice(0, 200).toLowerCase();
  const tokens = slice.split(/\W+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length < 3) return tokens;
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - 3; i += 1) {
    grams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return grams;
}

function diffCorpusLower(diffAddedLines: readonly string[]): string {
  return diffAddedLines.join("\n").toLowerCase();
}

function hasFingerprintMatch(content: string, corpusLower: string): boolean {
  const grams = fingerprintMemory(content);
  if (grams.length === 0) return false;
  for (const g of grams) {
    if (corpusLower.includes(g.toLowerCase())) return true;
  }
  // fallback: if content has <3 tokens, check token presence
  if (grams.length > 0 && grams.length < 3) {
    // grams are tokens in this branch
    for (const token of grams) {
      if (corpusLower.includes(token.toLowerCase())) return true;
    }
  }
  return false;
}

export function computeYieldAudit(input: YieldAuditInput): YieldAuditReport {
  const corpusLower = diffCorpusLower(input.diffAddedLines);

  // collect decisionTrace ids for O(1) lookup
  const decisionTraceIds = new Set<string>();
  for (const ev of input.evidence) {
    if (ev.decisionTraceIds) {
      for (const id of ev.decisionTraceIds) decisionTraceIds.add(id);
    }
  }

  // collect filtered read-index paths (ignore-aware)
  const readPaths = new Set<string>();
  for (const entry of input.readIndexEntries) {
    if (!isIgnored(entry.path)) readPaths.add(entry.path);
  }

  const rows: YieldRow[] = input.injected.map((mem) => {
    const injected = 1;

    let readIndex = false;
    if (mem.relatedFiles) {
      for (const f of mem.relatedFiles) {
        if (!isIgnored(f) && readPaths.has(f)) {
          readIndex = true;
          break;
        }
      }
    }

    const decisionTrace = decisionTraceIds.has(mem.id);
    const diffFingerprint = hasFingerprintMatch(mem.content, corpusLower);

    const reusedAtLeast = readIndex || decisionTrace || diffFingerprint ? 1 : 0;
    const yieldValue = injected > 0 ? reusedAtLeast / injected : 0;
    const tier = tierFor(yieldValue);

    return {
      id: mem.id,
      injected,
      reusedAtLeast,
      yield: yieldValue,
      tier,
      signals: { readIndex, decisionTrace, diffFingerprint },
    };
  });

  // deterministic sort: yield asc, then injected desc, then id desc for stability
  rows.sort((a, b) => {
    if (a.yield !== b.yield) return a.yield - b.yield;
    if (a.injected !== b.injected) return b.injected - a.injected;
    return b.id.localeCompare(a.id);
  });

  const MAX_ROWS = 50;
  let aggregatedRemaining = 0;
  let finalRows = rows;
  if (rows.length > MAX_ROWS) {
    aggregatedRemaining = rows.length - MAX_ROWS;
    finalRows = rows.slice(0, MAX_ROWS);
  }

  return {
    version: 1,
    window: { from: input.window.from, to: input.window.to },
    rows: finalRows,
    aggregatedRemaining,
    honestNote: "reused is a lower bound; absence does not prove uselessness",
    honestReceipt: { warnings: [] },
  };
}
