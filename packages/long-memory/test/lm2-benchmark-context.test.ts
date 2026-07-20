import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectLm1RankedRecords } from "../src/lm1-fused-selector.js";
import { type Lm1Record, lm1RecordSchema } from "../src/lm1-model.js";
import type { FileLm1Store } from "../src/lm1-store.js";
import { Lm2BenchmarkContextBuilder } from "../src/lm2-benchmark-context.js";

const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";

function snapshot(input: {
  id: string;
  text: string;
  observedAt: string;
  supersedesSnapshotId: string | null;
}): Extract<Lm1Record, { kind: "state_snapshot" }> {
  return lm1RecordSchema.parse({
    schemaVersion: 1,
    ...input,
    workspaceKey,
    kind: "state_snapshot",
    sourceDigest: input.id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    canonicalCaptureDigest: "a".repeat(64),
    evidenceBindingDigest: "b".repeat(64),
    recordedAt: input.observedAt,
    evidenceDigests: ["c".repeat(64)],
    status: "recorded",
    action: null,
    evidenceIds: [evidenceId],
    stateKey: "billing.status",
    representation: "value",
    redactionVersion: "redaction-v1",
  });
}

describe("LM2 benchmark public context", () => {
  it("keeps the benchmark runtime outside LM1 capture and selection", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/lm2-benchmark-runtime.ts"),
      "utf8",
    );

    expect(source).toContain("Lm2BenchmarkContextBuilder");
    expect(source).not.toMatch(/createLm[12]Runtime|runtime\.capture|runtime\.recall/u);
    expect(source).not.toMatch(/lm1-(?:capture|recall|fused-selector|store)/u);
  });

  it("shares candidate semantics without applying LM1 correction selection", async () => {
    const superseded = snapshot({
      id: "00000000-0000-4000-8000-000000000001",
      text: "Billing status was overdue.",
      observedAt: "2026-07-20T00:00:00.000Z",
      supersedesSnapshotId: null,
    });
    const current = snapshot({
      id: "00000000-0000-4000-8000-000000000002",
      text: "The account is settled.",
      observedAt: "2026-07-20T00:00:01.000Z",
      supersedesSnapshotId: superseded.id,
    });
    const candidate = {
      id: superseded.id,
      workspaceKey,
      observedAt: superseded.observedAt,
      kind: superseded.kind,
      text: superseded.text,
      sourceDigest: superseded.sourceDigest,
    };
    const benchmark = new Lm2BenchmarkContextBuilder().build({
      workspaceKey,
      tokenBudget: 100,
      orderedCandidates: [{ candidate, score: 1 }],
    });
    const store = {
      list: () => [superseded, current],
      closureSuccessorIds: () => ({
        successorIdsBySnapshotId: new Map([[superseded.id, [current.id]]]),
        incompletePredecessorSnapshotIds: new Set<string>(),
      }),
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[superseded.stateKey, [superseded, current]]]),
        indexedStateKeys: new Set([superseded.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as unknown as FileLm1Store;
    const lm1 = await selectLm1RankedRecords({
      store,
      evidenceEligibility: {
        resolve: async () => [
          { evidenceId, workspaceKey, status: "available", unresolvedHighRisk: false },
        ],
      },
      request: { workspaceKey, task: "billing overdue", tokenBudget: 100 },
      records: [superseded, current],
      ranked: [{ record: superseded, score: 1 }],
      scannedRecordCount: 1,
    });

    expect(benchmark.items).toEqual([
      { type: "text", value: superseded.text, observationId: superseded.id },
    ]);
    expect(lm1.items).toEqual([{ type: "text", value: current.text, observationId: current.id }]);
    expect(benchmark.receipt).toEqual({
      selected: [{ id: superseded.id, score: 1, tokenCount: 7 }],
      omitted: [],
      candidateCount: 1,
    });
  });
});
