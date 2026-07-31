import { z } from "zod";
import { ARM_RUNS } from "./budget.js";

// Resume namespaces start above both the four gate slots (0-3) and the probe
// slots (90-92). A resumed run must never reuse a namespace an earlier attempt
// already warmed, or it inherits that attempt's cache and stops being cold.
export const RESUME_SLOT_BASE = 200;

export type JournalRefusalCode = "recording_id_mismatch" | "journal_row_invalid";

export class JournalRefusal extends Error {
  readonly code: JournalRefusalCode;
  constructor(code: JournalRefusalCode, message?: string) {
    super(message ?? code);
    this.name = "JournalRefusal";
    this.code = code;
  }
}

const requestUsageSchema = z.object({
  inputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  outputTokens: z.number(),
});

export const armRunJournalEntrySchema = z.object({
  recordingId: z.string().min(1),
  armRunIndex: z.number().int().min(0).max(ARM_RUNS - 1),
  namespace: z.number().int().min(0),
  status: z.enum(["complete", "partial"]),
  usage: requestUsageSchema.extend({
    arm: z.enum(["baseline", "megasaver"]),
    normalizedCostUsd: z.number(),
    startedAtMs: z.number(),
    finishedAtMs: z.number(),
    perRequest: z.array(requestUsageSchema),
  }),
  integrity: z.object({
    applied: z.number(),
    appliedFraction: z.number(),
    originalBytes: z.number(),
    transformedBytes: z.number(),
    byteRatio: z.number(),
    ok: z.boolean(),
  }),
});

export type ArmRunJournalEntry = z.infer<typeof armRunJournalEntrySchema>;

export function loadJournal(rows: readonly unknown[]): ArmRunJournalEntry[] {
  return rows.map((row, i) => {
    const parsed = armRunJournalEntrySchema.safeParse(row);
    if (!parsed.success) {
      throw new JournalRefusal(
        "journal_row_invalid",
        `journal row ${i} is not a valid ArmRunJournalEntry: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    return parsed.data;
  });
}

function assertSameRecording(rows: readonly ArmRunJournalEntry[], recordingId: string): void {
  for (const row of rows) {
    if (row.recordingId !== recordingId) {
      throw new JournalRefusal(
        "recording_id_mismatch",
        `journal was recorded against ${row.recordingId}, not ${recordingId}`,
      );
    }
  }
}

// A partial arm run is retained as receipts and excluded here. Splicing a
// half-sent run into a verdict would mix two cache-warming histories into one
// cost object — manufacturing by hand the artefact the namespacing removes.
export function completedRuns(
  rows: readonly ArmRunJournalEntry[],
  recordingId: string,
): ArmRunJournalEntry[] {
  assertSameRecording(rows, recordingId);
  return rows.filter((row) => row.status === "complete");
}

export function pendingRunIndices(
  rows: readonly ArmRunJournalEntry[],
  recordingId: string,
): number[] {
  const done = new Set(completedRuns(rows, recordingId).map((row) => row.armRunIndex));
  return Array.from({ length: ARM_RUNS }, (_, i) => i).filter((i) => !done.has(i));
}

export function nextResumeNamespace(
  rows: readonly ArmRunJournalEntry[],
  armRunIndex: number,
): number {
  const used = new Set(rows.map((row) => row.namespace));
  let candidate = RESUME_SLOT_BASE + armRunIndex * 10;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}
