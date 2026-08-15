import type { TokenSaverEvent } from "@megasaver/core";

export type ReceiptExit =
  | { kind: "code"; code: number }
  | { kind: "terminated" }
  | { kind: "unrecorded" };

export type VerificationReceipt = {
  command: string; // event.label — redacted at the source before persist
  exit: ReceiptExit;
  recordedAt: string;
  sessionId: string;
  chunkSetId?: string;
};

function exitOf(childExitCode: number | null | undefined): ReceiptExit {
  if (childExitCode === undefined) return { kind: "unrecorded" };
  if (childExitCode === null) return { kind: "terminated" };
  return { kind: "code", code: childExitCode };
}

export function receiptsFromEvents(events: readonly TokenSaverEvent[]): VerificationReceipt[] {
  const receipts: VerificationReceipt[] = [];
  for (const event of events) {
    if (event.sourceKind !== "command") continue;
    receipts.push({
      command: event.label,
      exit: exitOf(event.childExitCode),
      recordedAt: event.createdAt,
      sessionId: event.sessionId,
      ...(event.chunkSetId !== undefined ? { chunkSetId: event.chunkSetId } : {}),
    });
  }
  return receipts;
}
