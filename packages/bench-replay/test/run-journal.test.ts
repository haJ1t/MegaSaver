import { describe, expect, it } from "vitest";
import {
  RESUME_SLOT_BASE,
  completedRuns,
  loadJournal,
  nextResumeNamespace,
  pendingRunIndices,
} from "../src/run-journal.js";
import type { ArmRunJournalEntry } from "../src/run-journal.js";

function entry(over: Partial<ArmRunJournalEntry> = {}): ArmRunJournalEntry {
  return {
    recordingId: "rec-big/task_1",
    armRunIndex: 0,
    namespace: 0,
    status: "complete",
    usage: {
      arm: "baseline",
      inputTokens: 10,
      cacheCreationTokens: 100,
      cacheReadTokens: 0,
      outputTokens: 1,
      normalizedCostUsd: 0.01,
      startedAtMs: 1,
      finishedAtMs: 2,
      perRequest: [],
    },
    integrity: {
      applied: 3,
      appliedFraction: 0.5,
      originalBytes: 1000,
      transformedBytes: 600,
      byteRatio: 0.6,
      ok: true,
    },
    ...over,
  } as ArmRunJournalEntry;
}

describe("run-journal", () => {
  it("excludes a partial arm run from the completed set", () => {
    const rows = [entry(), entry({ armRunIndex: 1, status: "partial" })];
    const done = completedRuns(rows, "rec-big/task_1");

    expect(done).toHaveLength(1);
    expect(done[0]?.armRunIndex).toBe(0);
  });

  it("lists a partial run as pending so resume re-sends it", () => {
    const rows = [entry(), entry({ armRunIndex: 1, status: "partial" })];
    expect(pendingRunIndices(rows, "rec-big/task_1")).toEqual([1, 2, 3]);
  });

  it("lists every run as pending for an empty journal", () => {
    expect(pendingRunIndices([], "rec-big/task_1")).toEqual([0, 1, 2, 3]);
  });

  it("allocates a fresh namespace on resume, never reusing a burnt one", () => {
    const rows = [
      entry({ namespace: 0 }),
      entry({ armRunIndex: 1, namespace: 1, status: "partial" }),
    ];
    const ns = nextResumeNamespace(rows, 1);

    expect(ns).toBeGreaterThanOrEqual(RESUME_SLOT_BASE);
    expect(rows.some((r) => r.namespace === ns)).toBe(false);
  });

  it("refuses a journal recorded against a different recording", () => {
    const rows = [entry({ recordingId: "rec-small/task_9" })];
    expect(() => completedRuns(rows, "rec-big/task_1")).toThrowError(
      expect.objectContaining({ code: "recording_id_mismatch" }),
    );
  });

  it("refuses a malformed journal row rather than silently dropping it", () => {
    expect(() => loadJournal([{ recordingId: "rec-big/task_1" }])).toThrowError(
      expect.objectContaining({ code: "journal_row_invalid" }),
    );
  });
});
