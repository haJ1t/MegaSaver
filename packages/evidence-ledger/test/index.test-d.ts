import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import * as ledger from "../src/index.js";
import type { EvidenceRecord, EvidenceRecordInput } from "../src/index.js";

describe("@megasaver/evidence-ledger public surface type checks", () => {
  it("all store functions are exported", () => {
    expectTypeOf(ledger.appendEvidence).toBeFunction();
    expectTypeOf(ledger.loadEvidence).toBeFunction();
    expectTypeOf(ledger.getEvidenceStatus).toBeFunction();
    expectTypeOf(ledger.listEvidenceByWorkspace).toBeFunction();
    expectTypeOf(ledger.pinEvidence).toBeFunction();
    expectTypeOf(ledger.unpinEvidence).toBeFunction();
    expectTypeOf(ledger.revokeEvidence).toBeFunction();
    expectTypeOf(ledger.explainEvidence).toBeFunction();
    expectTypeOf(ledger.gcEvidence).toBeFunction();
    expectTypeOf(ledger.evidenceRecordSchema).not.toBeNever();
  });

  it("EvidenceRecord has evidenceId", () => {
    expectTypeOf<EvidenceRecord>().toHaveProperty("evidenceId");
  });

  it("EvidenceRecordInput has no digest fields (callers cannot supply digests per spec §3)", () => {
    // The input type has NO digest fields — callers cannot supply digests (spec §3).
    expectTypeOf<EvidenceRecordInput>().not.toHaveProperty("rawDigest");
    expectTypeOf<EvidenceRecordInput>().toHaveProperty("redactedRawContent");
  });
});
