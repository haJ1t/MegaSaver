import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OverlayTokenSaverEvent } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readReceiptEvents, receiptCandidatesFromEvents } from "../src/receipts.js";

const WK = "0123456789abcdef";
const NOW = "2026-08-06T12:00:00.000Z";
const event = (over: Partial<OverlayTokenSaverEvent>): OverlayTokenSaverEvent => ({
  id: "e1",
  liveSessionId: "ls-1",
  workspaceKey: WK,
  createdAt: "2026-08-06T11:00:00.000Z",
  sourceKind: "command",
  label: "pnpm --filter @megasaver/core test",
  rawBytes: 10,
  returnedBytes: 5,
  bytesSaved: 5,
  savingRatio: 0.5,
  summary: "s",
  ...over,
});
const writeEvents = (root: string, rows: OverlayTokenSaverEvent[]): void => {
  mkdirSync(join(root, "stats", WK), { recursive: true });
  writeFileSync(
    join(root, "stats", WK, "ls-1.events.jsonl"),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
};

describe("receipts view", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "megasaver-receipts-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps only in-window command rows and maps childExitCode", () => {
    writeEvents(root, [
      event({ id: "e1", childExitCode: 0 }),
      event({ id: "e2", sourceKind: "file", label: "cat x" }),
      event({ id: "e3", createdAt: "2026-08-01T00:00:00.000Z", childExitCode: 0 }),
    ]);
    const rows = receiptCandidatesFromEvents(readReceiptEvents({ root }, { workspaceKey: WK }), { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exitCode).toBe(0);
    expect(rows[0]?.command).toContain("--filter @megasaver/core");
  });

  it("keeps exit-less rows (pre-C3) with exitCode absent", () => {
    writeEvents(root, [event({ id: "e1" })]); // no childExitCode field
    const rows = receiptCandidatesFromEvents(readReceiptEvents({ root }, { workspaceKey: WK }), { now: NOW });
    expect(rows).toHaveLength(1);
    expect("exitCode" in (rows[0] ?? {})).toBe(false); // renders "receipt without exit code"
  });

  it("returns [] for a missing store dir", () => {
    expect(readReceiptEvents({ root }, { workspaceKey: WK })).toEqual([]);
  });
});
