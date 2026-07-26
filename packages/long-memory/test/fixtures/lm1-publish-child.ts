import type { Lm1Record } from "../../src/lm1-model.js";
import { createLm1Runtime } from "../../src/lm1-runtime.js";

const record = JSON.parse(process.env.MEGASAVER_LM1_RECORD ?? "{}") as Lm1Record;
const {
  id: _id,
  sourceDigest: _sourceDigest,
  evidenceBindingDigest: _bindingDigest,
  recordedAt: _recordedAt,
  evidenceDigests: _evidenceDigests,
  status: _status,
  ...prepared
} = record;
const runtime = createLm1Runtime({
  storeRoot: process.env.MEGASAVER_LM1_ROOT ?? "",
  redaction: {
    version: "redaction-v1",
    redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
  },
  evidenceBinding: {
    verify: async ({ evidenceIds }) => ({
      evidence: evidenceIds.map((evidenceId) => ({ evidenceId, evidenceDigest: "a".repeat(64) })),
    }),
  },
  evidenceEligibility: {
    resolve: async ({ workspaceKey, evidenceIds }) =>
      evidenceIds.map((evidenceId) => ({
        evidenceId,
        workspaceKey,
        status: "available" as const,
        unresolvedHighRisk: false,
      })),
  },
  clock: { now: () => record.recordedAt },
});
const result = await runtime.capture.capturePrepared({ prepared, authorization: "signed" });
process.stdout.write(JSON.stringify(result));
