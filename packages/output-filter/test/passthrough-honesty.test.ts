import { describe, expect, it } from "vitest";
import {
  HARD_WRAP_THRESHOLD_TOKENS,
  PASSTHROUGH_THRESHOLD_TOKENS,
  estimateTokens,
  filterOutput,
} from "../src/index.js";
import type { FilterOutputResult } from "../src/index.js";

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

// Two further blocks, each in its own vocabulary. They exist so the light-band
// fixture can be built by CONCATENATION rather than repetition: a repeated
// block would survive the collapse passes here only by the accident that
// semantic chunking currently skips dedupe, and the band's byte accounting
// would then rest on that accident instead of on the band.
const DISTINCT_ROSTER_SOURCE = [
  'import { EventEmitter } from "node:events";',
  'import { setTimeout as delay } from "node:timers/promises";',
  "",
  "export type ShiftSlot = { staffId: string; startsAt: string; hours: number };",
  "export type RosterConflict = { slotIndex: number; reason: string };",
  "",
  "const MIN_REST_HOURS = 11;",
  "const MAX_SHIFT_HOURS = 12;",
  "const SETTLE_DELAY_MS = 250;",
  "",
  "export function slotEndHour(slot: ShiftSlot): number {",
  "  return new Date(slot.startsAt).getUTCHours() + slot.hours;",
  "}",
  "",
  "export function overlaps(left: ShiftSlot, right: ShiftSlot): boolean {",
  "  const leftEnd = slotEndHour(left);",
  "  const rightStart = new Date(right.startsAt).getUTCHours();",
  "  return left.staffId === right.staffId && rightStart < leftEnd;",
  "}",
  "",
  "export function restGap(previous: ShiftSlot, next: ShiftSlot): number {",
  "  const span = new Date(next.startsAt).getTime() - new Date(previous.startsAt).getTime();",
  "  return span / 3_600_000 - previous.hours;",
  "}",
  "",
  "export function auditRoster(slots: readonly ShiftSlot[]): RosterConflict[] {",
  "  const conflicts: RosterConflict[] = [];",
  "  slots.forEach((slot, slotIndex) => {",
  "    if (slot.hours > MAX_SHIFT_HOURS) conflicts.push({ slotIndex, reason: 'shift too long' });",
  "    const previous = slots[slotIndex - 1];",
  "    if (previous !== undefined && restGap(previous, slot) < MIN_REST_HOURS) {",
  "      conflicts.push({ slotIndex, reason: 'insufficient rest' });",
  "    }",
  "  });",
  "  return conflicts;",
  "}",
  "",
  "export class RosterBus extends EventEmitter {",
  "  async announce(conflicts: readonly RosterConflict[]): Promise<number> {",
  "    await delay(SETTLE_DELAY_MS);",
  "    for (const conflict of conflicts) this.emit('conflict', conflict);",
  "    return conflicts.length;",
  "  }",
  "}",
].join("\n");

const DISTINCT_TELEMETRY_SOURCE = [
  'import { performance } from "node:perf_hooks";',
  'import { gzipSync } from "node:zlib";',
  "",
  "export type Sample = { metric: string; value: number; unit: 'ms' | 'bytes' };",
  "export type Rollup = { metric: string; mid: number; tail: number; count: number };",
  "",
  "const PERCENTILE_MID = 0.5;",
  "const PERCENTILE_TAIL = 0.95;",
  "const FLUSH_BATCH = 512;",
  "",
  "export function quantile(sorted: readonly number[], fraction: number): number {",
  "  if (sorted.length === 0) return 0;",
  "  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));",
  "  return sorted[index] ?? 0;",
  "}",
  "",
  "export function rollup(metric: string, samples: readonly Sample[]): Rollup {",
  "  const values = samples.filter((one) => one.metric === metric).map((one) => one.value);",
  "  const sorted = [...values].sort((left, right) => left - right);",
  "  return {",
  "    metric,",
  "    mid: quantile(sorted, PERCENTILE_MID),",
  "    tail: quantile(sorted, PERCENTILE_TAIL),",
  "    count: sorted.length,",
  "  };",
  "}",
  "",
  "export function measure<T>(label: string, body: () => T): [T, Sample] {",
  "  const began = performance.now();",
  "  const produced = body();",
  "  const elapsed = performance.now() - began;",
  "  return [produced, { metric: label, value: elapsed, unit: 'ms' }];",
  "}",
  "",
  "export function packBatch(samples: readonly Sample[]): Buffer {",
  "  const batch = samples.slice(0, FLUSH_BATCH);",
  "  const payload = batch.map((one) => `${one.metric} ${one.value} ${one.unit}`).join('|');",
  "  return gzipSync(Buffer.from(payload, 'utf8'));",
  "}",
  "",
  "export function describeRollup(entry: Rollup): string {",
  "  return `${entry.metric}: mid=${entry.mid} tail=${entry.tail} over ${entry.count}`;",
  "}",
].join("\n");

const LIGHT_BAND_SOURCE = [
  DISTINCT_TS_SOURCE,
  DISTINCT_ROSTER_SOURCE,
  DISTINCT_TELEMETRY_SOURCE,
].join("\n");

// What the caller is actually handed. filterOutput's result IS the payload on
// the exec and MCP paths — the summary line is delivered text, not a label —
// so this is the sum returnedBytes has to report, in every band including
// outline (SC3-1/S4-8 closed the outline branch's skeleton-only undercount).
// Applied in tests that pin their decision so a fixture drifting into another
// band fails loudly.
function deliveredBytes(result: FilterOutputResult): number {
  return (
    Buffer.byteLength(result.summary, "utf8") +
    result.excerpts.reduce((sum, e) => sum + Buffer.byteLength(e.text, "utf8"), 0)
  );
}

function deliveredTokens(result: FilterOutputResult): number {
  return (
    estimateTokens(result.summary) +
    result.excerpts.reduce((sum, e) => sum + estimateTokens(e.text), 0)
  );
}

const FILE_SOURCE = { kind: "file", path: "src/ledger-window.ts" } as const;

describe("non-compressed bands report what they actually deliver", () => {
  it("counts the summary line into returnedBytes, not just the excerpts", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "balanced",
      source: FILE_SOURCE,
    });

    // Pinned so the case cannot silently drift into the light or compressed
    // band and keep passing for a reason the finding was not about.
    expect(result.decision).toBe("passthrough");

    // The identity the whole finding rests on, stated independently of how big
    // the overshoot happens to be. record-output can no longer observe this —
    // its passthrough branch reports the raw shape — so if it is not pinned
    // here it is pinned nowhere.
    expect(result.returnedBytes).toBe(deliveredBytes(result));
  });

  it("never claims a saving the delivered payload did not make", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "balanced",
      source: FILE_SOURCE,
    });

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

  it("still counts the summary when it dwarfs the payload", async () => {
    const result = await filterOutput({ raw: "hello, world!", mode: "balanced" });

    expect(result.decision).toBe("passthrough");
    // The extreme the finding named: a 13-byte payload reported as 62 bytes.
    // Here the summary is most of what is returned, so an implementation that
    // dropped it from the count could not hide behind chunk-boundary rounding.
    expect(result.rawBytes).toBe(13);
    expect(result.returnedBytes).toBe(deliveredBytes(result));
    expect(result.returnedBytes).toBeGreaterThan(4 * result.rawBytes);
    expect(result.deltaBytes).toBeLessThan(0);
  });

  it("represents the overshoot as a signed loss instead of collapsing it to zero", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "safe",
      source: FILE_SOURCE,
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

  it("keeps the light band's accounting its own, not the passthrough band's", async () => {
    const result = await filterOutput({
      raw: LIGHT_BAND_SOURCE,
      mode: "balanced",
      source: FILE_SOURCE,
    });

    // Measured, not assumed: an earlier brief called ~6 KB passthrough when it
    // is light. The token window is asserted alongside the label so a fixture
    // that drifts out of the band fails loudly instead of re-testing
    // passthrough under a light-band name.
    expect(result.rawTokens).toBeGreaterThanOrEqual(PASSTHROUGH_THRESHOLD_TOKENS);
    expect(result.rawTokens).toBeLessThan(HARD_WRAP_THRESHOLD_TOKENS);
    expect(result.decision).toBe("light");

    // Light is a distinct band with a distinct summary. If the passthrough
    // summary branch ever widened to cover light, the label would stay "light"
    // while the delivered bytes silently became the passthrough band's — the
    // exact substitution these two lines refuse.
    expect(result.summary).not.toContain("below compression threshold");
    expect(result.summary).toMatch(/^\d+ kept, \d+ dropped/);

    expect(result.returnedBytes).toBe(deliveredBytes(result));
    expect(result.deltaBytes).toBe(result.rawBytes - result.returnedBytes);

    // Light keeps every chunk, so whatever it reports has to stay next to the
    // input size. A large saving here would mean content went missing under a
    // band whose contract is to drop nothing.
    expect(Math.abs(result.deltaBytes ?? 0)).toBeLessThan(result.rawBytes * 0.02);
  });

  // SC3-1/S4-8 (spec §7 item 2, M13): the outline branch counted the skeleton
  // alone while the same result carried the summary string — every outline
  // read's bytesSaved/savingRatio/deltaBytes overstated the saving by the
  // summary's size, and returnedTokens undercounted identically.
  it("outline counts its summary into returnedBytes and returnedTokens", async () => {
    const result = await filterOutput({
      raw: DISTINCT_TS_SOURCE,
      mode: "safe",
      outline: true,
      source: FILE_SOURCE,
    });

    expect(result.decision).toBe("outline");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.returnedBytes).toBe(deliveredBytes(result));
    expect(result.returnedTokens).toBe(deliveredTokens(result));
    expect(result.deltaBytes).toBe(result.rawBytes - result.returnedBytes);
  });

  it("keeps the signed field in agreement with the clamped one when a saving is real", async () => {
    const raw = `${DISTINCT_TS_SOURCE}\n`.repeat(60);
    const result = await filterOutput({
      raw,
      mode: "aggressive",
      source: FILE_SOURCE,
    });

    expect(result.decision).toBe("compressed");
    // Stated here rather than in the passthrough cases because only here is the
    // antecedent actually true — under a zero ratio the implication is vacuous
    // and would assert nothing.
    expect(result.savingRatio).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeLessThan(result.rawBytes);
    expect(result.returnedBytes).toBe(deliveredBytes(result));
    expect(result.deltaBytes).toBe(result.rawBytes - result.returnedBytes);
    expect(result.deltaBytes).toBeGreaterThan(0);
    // The contract between the two fields, not the coincidence that they are
    // equal here: bytesSaved is the clamp of the signed value, in every band.
    expect(result.bytesSaved).toBe(Math.max(0, result.deltaBytes ?? 0));
  });
});
