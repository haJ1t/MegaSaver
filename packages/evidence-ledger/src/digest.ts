import { createHash } from "node:crypto";

// The LEDGER computes digests over POST-REDACTION content (spec §3). Callers
// pass the redacted content via appendEvidence; they never supply a raw digest.
// Pre-redaction hashes are forbidden: they become equality/presence oracles.
export function digestContent(postRedactionText: string): string {
  return createHash("sha256").update(postRedactionText, "utf8").digest("hex");
}
