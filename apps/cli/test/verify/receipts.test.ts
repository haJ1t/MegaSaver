import type { TokenSaverEvent } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { receiptsFromEvents } from "../../src/commands/verify/receipts.js";

function event(overrides: Partial<TokenSaverEvent>): TokenSaverEvent {
  return {
    id: "evt-1",
    sessionId: "22222222-2222-4222-8222-222222222222",
    projectId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-08-06T11:50:00.000Z",
    sourceKind: "command",
    label: "grep error src",
    rawBytes: 2000,
    returnedBytes: 500,
    bytesSaved: 1500,
    savingRatio: 0.75,
    summary: "3 kept",
    ...overrides,
  } as TokenSaverEvent;
}

describe("receiptsFromEvents", () => {
  it("keeps only command-source events", () => {
    const receipts = receiptsFromEvents([
      event({ childExitCode: 0 }),
      event({ id: "evt-2", sourceKind: "file" }),
    ]);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.command).toBe("grep error src");
  });

  it("maps the exit-code tri-state: number, null=terminated, absent=unrecorded", () => {
    const [zero, killed, old] = receiptsFromEvents([
      event({ childExitCode: 0 }),
      event({ id: "evt-2", childExitCode: null }),
      event({ id: "evt-3" }),
    ]);
    expect(zero?.exit).toEqual({ kind: "code", code: 0 });
    expect(killed?.exit).toEqual({ kind: "terminated" });
    expect(old?.exit).toEqual({ kind: "unrecorded" });
  });

  it("carries chunkSetId only when the event has one (exactOptionalPropertyTypes)", () => {
    const [withChunks, without] = receiptsFromEvents([
      event({ chunkSetId: "cs-abc" }),
      event({ id: "evt-2" }),
    ]);
    expect(withChunks?.chunkSetId).toBe("cs-abc");
    expect(without !== undefined && "chunkSetId" in without).toBe(false);
  });
});
