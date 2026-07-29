import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/index.js";

// Genuinely varied source, not a repeated template: the normalize pass runs
// collapseRepeatedLines + collapseSimilar before chunking, so a generated
// `const a0 = 0; const a1 = 1;` corpus collapses and the payload shrinks for a
// reason that has nothing to do with the band under test. Distinct vocabulary
// per line keeps the passthrough band lossless, which is the precondition the
// inflation measurement needs.
const DISTINCT_TS_SOURCE = [
  'import { createHash } from "node:crypto";',
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { dirname, join, resolve } from "node:path";',
  "",
  "export type LedgerWindow = { openedAt: string; closedAt: string | null };",
  "export type ReconcileVerdict = { balanced: boolean; drift: number };",
  "",
  "const MAX_WINDOW_DAYS = 30;",
  "const DRIFT_TOLERANCE_CENTS = 2;",
  "const ARCHIVE_SUFFIX = '.archive.jsonl';",
  "",
  "export function hashWindow(window: LedgerWindow): string {",
  '  return createHash("sha256").update(JSON.stringify(window)).digest("hex");',
  "}",
  "",
  "export function windowSpanDays(window: LedgerWindow, now: Date): number {",
  "  const end = window.closedAt === null ? now : new Date(window.closedAt);",
  "  const millis = end.getTime() - new Date(window.openedAt).getTime();",
  "  return Math.floor(millis / 86_400_000);",
  "}",
  "",
  "export function isStale(window: LedgerWindow, now: Date): boolean {",
  "  return windowSpanDays(window, now) > MAX_WINDOW_DAYS;",
  "}",
  "",
  "export function reconcile(debits: number[], credits: number[]): ReconcileVerdict {",
  "  const owed = debits.reduce((sum, cents) => sum + cents, 0);",
  "  const paid = credits.reduce((sum, cents) => sum + cents, 0);",
  "  const drift = owed - paid;",
  "  return { balanced: Math.abs(drift) <= DRIFT_TOLERANCE_CENTS, drift };",
  "}",
  "",
  "export function archivePathFor(ledgerPath: string): string {",
  "  const folder = dirname(resolve(ledgerPath));",
  "  const stem = ledgerPath.replace(/\\.jsonl$/u, '');",
  "  return join(folder, `${stem}${ARCHIVE_SUFFIX}`);",
  "}",
  "",
  "export function rotate(ledgerPath: string, now: Date): string | null {",
  '  const body = readFileSync(ledgerPath, "utf8");',
  "  if (body.trim().length === 0) return null;",
  "  const target = archivePathFor(ledgerPath);",
  "  writeFileSync(target, `${now.toISOString()}\\n${body}`);",
  '  writeFileSync(ledgerPath, "");',
  "  return target;",
  "}",
  "",
  "export function summarise(verdict: ReconcileVerdict): string {",
  '  if (verdict.balanced) return "ledger balanced within tolerance";',
  "  const direction = verdict.drift > 0 ? 'under-collected' : 'over-collected';",
  "  return `ledger ${direction} by ${Math.abs(verdict.drift)} cents`;",
  "}",
].join("\n");

describe("passthrough band reports what it actually did", () => {
  it("never claims a saving the delivered payload did not make", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "balanced",
      source: { kind: "file", path: "src/ledger-window.ts" },
    });

    // Pinned so the case cannot silently drift into the light or compressed
    // band and keep passing for a reason the finding was not about.
    expect(result.decision).toBe("passthrough");

    // The measured defect: the summary line is counted into what is returned,
    // so the band that exists to leave small outputs alone hands back MORE
    // bytes than it received. Asserted as a relation, not as a constant —
    // the size of the overshoot moves with chunk count.
    expect(result.returnedBytes).toBeGreaterThan(result.rawBytes);

    // …and having grown, it reports no saving at all. Together with the line
    // above this is the no-false-saving claim: a band that added bytes must not
    // surface a positive ratio for them.
    expect(result.savingRatio).toBe(0);
    expect(result.bytesSaved).toBe(0);
  });

  it("represents the overshoot as a signed loss instead of collapsing it to zero", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "safe",
      source: { kind: "file", path: "src/ledger-window.ts" },
    });

    expect(result.decision).toBe("passthrough");
    // bytesSaved/savingRatio are clamped at zero by contract, so on their own
    // they cannot tell a break-even result from an inflating one. deltaBytes
    // is the signed counterpart: negative means the payload grew.
    expect(result.deltaBytes).toBe(result.rawBytes - result.returnedBytes);
    expect(result.deltaBytes).toBeLessThan(0);
    // The clamped fields keep their existing meaning for existing readers.
    expect(result.bytesSaved).toBe(0);
  });

  it("keeps the signed field in agreement with the clamped one when a saving is real", async () => {
    const raw = `${DISTINCT_TS_SOURCE}\n`.repeat(60);
    const result = await filterOutput({
      raw,
      mode: "aggressive",
      source: { kind: "file", path: "src/ledger-window.ts" },
    });

    expect(result.decision).toBe("compressed");
    // Stated here rather than in the passthrough cases because only here is the
    // antecedent actually true — under a zero ratio the implication is vacuous
    // and would assert nothing.
    expect(result.savingRatio).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeLessThan(result.rawBytes);
    expect(result.deltaBytes).toBe(result.rawBytes - result.returnedBytes);
    expect(result.deltaBytes).toBeGreaterThan(0);
    // The contract between the two fields, not the coincidence that they are
    // equal here: bytesSaved is the clamp of the signed value, in every band.
    expect(result.bytesSaved).toBe(Math.max(0, result.deltaBytes ?? 0));
  });
});
