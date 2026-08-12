import { defineCommand } from "citty";
import { reviewAttestCommand } from "./attest.js";
import { reviewCheckCommand } from "./check.js";

export {
  parseRange,
  reviewAttestCommand,
  runReviewAttest,
  type RunReviewAttestInput,
} from "./attest.js";
export {
  classifyAttestations,
  reviewCheckCommand,
  runReviewCheck,
  type ReviewCheckResult,
  type ReviewCheckStatus,
  type RunReviewCheckInput,
} from "./check.js";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Review attestation: record and check reviewer verdicts against diff hashes.",
  },
  subCommands: {
    attest: reviewAttestCommand,
    check: reviewCheckCommand,
  },
});
