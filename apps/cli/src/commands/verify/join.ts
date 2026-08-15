import type { DetectedClaim } from "./claim-patterns.js";
import type { VerificationReceipt } from "./receipts.js";

export type ClaimVerdict = "verified" | "exit-mismatch" | "exit-unrecorded" | "no-receipt";

export type VerifiedClaim = {
  claim: DetectedClaim;
  receipt: VerificationReceipt | undefined;
  verdict: ClaimVerdict;
};

export type JoinResult = { rows: VerifiedClaim[]; considered: VerificationReceipt[] };

function verdictOf(receipt: VerificationReceipt | undefined): ClaimVerdict {
  if (receipt === undefined) return "no-receipt";
  switch (receipt.exit.kind) {
    case "code":
      return receipt.exit.code === 0 ? "verified" : "exit-mismatch";
    case "terminated":
      return "exit-mismatch";
    case "unrecorded":
      return "exit-unrecorded";
  }
}

export function joinClaimsToReceipts(input: {
  claims: readonly DetectedClaim[];
  receipts: readonly VerificationReceipt[];
  now: string;
  windowMinutes: number;
}): JoinResult {
  const floorMs = Date.parse(input.now) - input.windowMinutes * 60_000;
  const considered = input.receipts
    .filter((receipt) => {
      const ts = Date.parse(receipt.recordedAt);
      return Number.isFinite(ts) && ts >= floorMs;
    })
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const newest = considered[considered.length - 1];
  const rows = input.claims.map((claim) => ({
    claim,
    receipt: newest,
    verdict: verdictOf(newest),
  }));
  return { rows, considered };
}
