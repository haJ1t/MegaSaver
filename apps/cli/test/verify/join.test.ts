import { describe, expect, it } from "vitest";
import { joinClaimsToReceipts } from "../../src/commands/verify/join.js";
import type { VerificationReceipt } from "../../src/commands/verify/receipts.js";

const NOW = "2026-08-06T12:00:00.000Z";
const CLAIM = { patternId: "tests-pass", excerpt: "tests pass", index: 0 };

function receipt(recordedAt: string, exit: VerificationReceipt["exit"]): VerificationReceipt {
  return {
    command: "grep error",
    exit,
    recordedAt,
    sessionId: "22222222-2222-4222-8222-222222222222",
  };
}

describe("joinClaimsToReceipts", () => {
  it("verdicts verified on a clean in-window receipt", () => {
    const { rows, considered } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:45:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("verified");
    expect(considered).toHaveLength(1);
  });

  it("excludes receipts outside the window — no-receipt", () => {
    const { rows, considered } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:00:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("no-receipt");
    expect(rows[0]?.receipt).toBeUndefined();
    expect(considered).toHaveLength(0);
  });

  it("the NEWEST in-window receipt wins the join", () => {
    const { rows } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [
        receipt("2026-08-06T11:40:00.000Z", { kind: "code", code: 0 }),
        receipt("2026-08-06T11:55:00.000Z", { kind: "code", code: 2 }),
      ],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("exit-mismatch");
  });

  it("terminated is a mismatch; unrecorded is its own verdict, never verified", () => {
    const killed = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:55:00.000Z", { kind: "terminated" })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(killed.rows[0]?.verdict).toBe("exit-mismatch");

    const preC3 = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:55:00.000Z", { kind: "unrecorded" })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(preC3.rows[0]?.verdict).toBe("exit-unrecorded");
  });

  it("the exact window edge is inclusive", () => {
    const { rows } = joinClaimsToReceipts({
      claims: [CLAIM],
      receipts: [receipt("2026-08-06T11:30:00.000Z", { kind: "code", code: 0 })],
      now: NOW,
      windowMinutes: 30,
    });
    expect(rows[0]?.verdict).toBe("verified");
  });
});
