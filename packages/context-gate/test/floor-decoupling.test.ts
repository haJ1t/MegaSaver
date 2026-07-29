import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TokenSaverMode, modeToBudget } from "@megasaver/shared";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SAVING_FLOORS, NO_FLOORS, admitCompression } from "../src/admission-guard.js";
import { COMPRESS_FLOOR_BYTES, recordAndFilterOverlayOutput } from "../src/record-output.js";

const { admitSpy } = vi.hoisted(() => ({ admitSpy: vi.fn() }));

// White-box, and deliberately so. No content the eligibility floor admits saves
// little enough to be refused by the shipped floors (see the measurement in
// admission-guard.ts), so dropping the floors at the record call site is
// invisible to every black-box assertion — passthrough decisions look identical
// whether the floors are on or off. Recording the argument is the only way this
// wiring can fail a test.
vi.mock("../src/admission-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admission-guard.js")>();
  return {
    ...actual,
    admitCompression: (...args: Parameters<typeof actual.admitCompression>) => {
      admitSpy(...args);
      return actual.admitCompression(...args);
    },
  };
});

const WK = "0123456789abcdef";
const SID = "live-sess-1";

function store(): string {
  return mkdtempSync(join(tmpdir(), "ms-floor-"));
}

// ~3 KB of DISTINCT TypeScript. Distinctness is load-bearing: normalize's
// repeated/similar collapse folds templated lines, and a fixture built by
// repetition would measure that redundancy instead of the budget. Written as a
// literal (no backticks, no interpolation) so its bytes are stable.
const SMALL_TS_SOURCE = `import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  amountMinor: z.number().int(),
  currency: z.enum(["EUR", "GBP", "USD"]),
  memo: z.string().max(280).optional(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export class BalanceMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super("ledger balance drifted: expected " + expected + ", saw " + actual);
    this.name = "BalanceMismatchError";
  }
}

function fingerprint(entry: LedgerEntry): string {
  const material = entry.id + "|" + entry.amountMinor + "|" + entry.currency;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function loadLedger(path: string): LedgerEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new TypeError("ledger file is not an array");
  return parsed.map((row) => ledgerEntrySchema.parse(row));
}

export function persistLedger(path: string, entries: readonly LedgerEntry[]): void {
  const ordered = [...entries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  writeFileSync(path, JSON.stringify(ordered, null, 2), "utf8");
}

export function reconcile(
  entries: readonly LedgerEntry[],
  expectedMinor: number,
): Map<string, string> {
  const seen = new Map<string, string>();
  let running = 0;
  for (const entry of entries) {
    const print = fingerprint(entry);
    if (seen.has(print)) continue;
    seen.set(print, entry.id);
    running += entry.amountMinor;
  }
  if (running !== expectedMinor) {
    throw new BalanceMismatchError(expectedMinor, running);
  }
  return seen;
}

export function draftEntry(amountMinor: number, memo?: string): LedgerEntry {
  const base = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    amountMinor,
    currency: "EUR" as const,
  };
  return memo === undefined ? base : { ...base, memo };
}

export function summarise(entries: readonly LedgerEntry[]): string {
  const byCurrency = new Map<string, number>();
  for (const entry of entries) {
    const prior = byCurrency.get(entry.currency) ?? 0;
    byCurrency.set(entry.currency, prior + entry.amountMinor);
  }
  const parts: string[] = [];
  for (const [currency, total] of byCurrency) {
    parts.push(currency + " " + (total / 100).toFixed(2));
  }
  return parts.join(", ");
}

export function splitByMonth(entries: readonly LedgerEntry[]): Map<string, LedgerEntry[]> {
  const buckets = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const month = entry.createdAt.slice(0, 7);
    const bucket = buckets.get(month);
    if (bucket === undefined) buckets.set(month, [entry]);
    else bucket.push(entry);
  }
  return buckets;
}

export function largestDebit(entries: readonly LedgerEntry[]): LedgerEntry | null {
  let worst: LedgerEntry | null = null;
  for (const entry of entries) {
    if (entry.amountMinor >= 0) continue;
    if (worst === null || entry.amountMinor < worst.amountMinor) worst = entry;
  }
  return worst;
}
`;

const MODES: readonly TokenSaverMode[] = ["aggressive", "balanced", "safe"];

describe("W1 lever (a): the eligibility floor is decoupled from the mode budget", () => {
  it("keeps the fixture inside the band this suite reasons about", () => {
    const bytes = Buffer.byteLength(SMALL_TS_SOURCE, "utf8");
    // Above the decoupled floor, far below every mode budget (4000/12000/32000)
    // — so a pass here can only come from the decoupled floor, never a budget.
    expect(bytes).toBeGreaterThan(COMPRESS_FLOOR_BYTES);
    expect(bytes).toBeLessThan(modeToBudget("aggressive"));
  });

  it("compresses a ~3 KB input in the shipped default mode and clears the guard", async () => {
    const r = await recordAndFilterOverlayOutput({
      storeRoot: store(),
      workspaceKey: WK,
      liveSessionId: SID,
      raw: SMALL_TS_SOURCE,
      sourceKind: "file",
      label: "/Users/x/proj/src/ledger.ts",
      // "safe" is DEFAULT_MODE. Its 32 KB budget used to be the eligibility
      // floor, so this input passed through untouched and no chunk set was
      // written — the input had no recovery handle at all.
      mode: "safe",
      storeRawOutput: true,
      includeFooter: true,
    });
    expect(r.decision).toBe("compressed");
    expect(r.chunkSetId).toBeDefined();
    // Clearing the shipped floors is the second half of the claim: the input is
    // worth touching AND the rewrite is worth delivering. Asserted against the
    // shipped constants so raising either past the measured data fails here.
    expect(r.bytesSaved).toBeGreaterThan(DEFAULT_SAVING_FLOORS.absoluteBytes);
    expect(r.savingRatio).toBeGreaterThan(DEFAULT_SAVING_FLOORS.relative);
  });

  it("compresses the same ~3 KB input in every mode, not just the smallest budget", async () => {
    for (const mode of MODES) {
      const r = await recordAndFilterOverlayOutput({
        storeRoot: store(),
        workspaceKey: WK,
        liveSessionId: SID,
        raw: SMALL_TS_SOURCE,
        sourceKind: "file",
        label: "/Users/x/proj/src/ledger.ts",
        mode,
        storeRawOutput: true,
        includeFooter: true,
      });
      expect({ mode, decision: r.decision }).toEqual({ mode, decision: "compressed" });
    }
  });
});

// The guard's floors were parameters defaulting to off. Nothing in the measured
// corpus above the eligibility floor is refused by the shipped values, so a
// pipeline test cannot distinguish them from NO_FLOORS — only a direct call can.
describe("W2 follow-up: the shipped admission floors are active", () => {
  it("refuses a rewrite that saves fewer bytes than the absolute floor", () => {
    const rawBytes = 40_000;
    const returnedBytes = rawBytes - (DEFAULT_SAVING_FLOORS.absoluteBytes - 1);
    expect(admitCompression(rawBytes, returnedBytes, NO_FLOORS)).toEqual({ admit: true });
    expect(admitCompression(rawBytes, returnedBytes, DEFAULT_SAVING_FLOORS)).toEqual({
      admit: false,
      reason: "below_absolute_floor",
    });
  });

  it("refuses a rewrite whose saving is a smaller share than the relative floor", () => {
    const rawBytes = 40_000;
    // Comfortably past the absolute floor, so only the relative one can refuse it.
    const returnedBytes = Math.ceil(rawBytes * (1 - DEFAULT_SAVING_FLOORS.relative / 2));
    expect(rawBytes - returnedBytes).toBeGreaterThan(DEFAULT_SAVING_FLOORS.absoluteBytes);
    expect(admitCompression(rawBytes, returnedBytes, NO_FLOORS)).toEqual({ admit: true });
    expect(admitCompression(rawBytes, returnedBytes, DEFAULT_SAVING_FLOORS)).toEqual({
      admit: false,
      reason: "below_relative_floor",
    });
  });

  it("is what the record path asks the guard for", async () => {
    admitSpy.mockClear();
    await recordAndFilterOverlayOutput({
      storeRoot: store(),
      workspaceKey: WK,
      liveSessionId: SID,
      raw: SMALL_TS_SOURCE,
      sourceKind: "file",
      label: "/Users/x/proj/src/ledger.ts",
      mode: "safe",
      storeRawOutput: true,
      includeFooter: true,
    });
    expect(admitSpy).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      DEFAULT_SAVING_FLOORS,
    );
  });

  it("admits the worst cell measured at the eligibility floor", () => {
    // tsc-shaped output, safe mode, raw = 2048 B → 619 B saved, ratio 0.302:
    // the smallest saving found across 10 content shapes x 3 modes at the floor.
    // Both floors sit ~2x below it, which is why they cannot re-open the
    // aggressive dead band PR #278 closed.
    expect(admitCompression(2048, 2048 - 619, DEFAULT_SAVING_FLOORS)).toEqual({ admit: true });
  });
});
