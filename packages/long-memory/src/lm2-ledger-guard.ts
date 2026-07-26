import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { Lm2Error } from "./lm2-errors.js";
import { parseLm2QuotaLedger } from "./lm2-ledger-recovery.js";
import {
  type Lm2QuotaLedger,
  MAX_LM2_QUOTA_LEDGER_BYTES,
  serializeLm2QuotaLedger,
} from "./lm2-quota-ledger.js";
import { type DirectoryAnchor, sameFileIdentity } from "./lm2-secure-fs.js";
import { type ExactAnchoredFileRead, readExactAnchoredFile } from "./lm2-secure-read.js";

export type Lm2LedgerGuard = {
  ledger: Lm2QuotaLedger;
  serialized: string;
  contentDigest: string;
  stat: Stats;
};

function samePermanentFence(left: Lm2QuotaLedger, right: Lm2QuotaLedger): boolean {
  return (
    left.generation === right.generation &&
    left.epoch === right.epoch &&
    left.lockToken === right.lockToken &&
    left.lockIdentity.device === right.lockIdentity.device &&
    left.lockIdentity.inode === right.lockIdentity.inode
  );
}

export function createLm2LedgerGuard(input: {
  read: Pick<ExactAnchoredFileRead, "raw" | "stat" | "contentDigest">;
  workspaceKey: string;
  expected?: Lm2QuotaLedger;
}): Lm2LedgerGuard {
  const ledger = parseLm2QuotaLedger(input.read.raw, input.workspaceKey);
  const canonicalSerialized = ledger === null ? "" : serializeLm2QuotaLedger(ledger);
  const serialized = input.read.raw.toString("utf8");
  const contentDigest = createHash("sha256").update(input.read.raw).digest("hex");
  if (
    ledger === null ||
    contentDigest !== input.read.contentDigest ||
    (input.expected !== undefined &&
      (canonicalSerialized !== serializeLm2QuotaLedger(input.expected) ||
        !samePermanentFence(ledger, input.expected)))
  ) {
    throw new Lm2Error("index_lock_unavailable", "LM2 ledger guard changed.");
  }
  return { ledger, serialized, contentDigest, stat: input.read.stat };
}

export function revalidateLm2LedgerGuard(input: {
  anchor: DirectoryAnchor;
  name: string;
  workspaceKey: string;
  guard: Lm2LedgerGuard;
}): void {
  const read = readExactAnchoredFile({
    anchor: input.anchor,
    name: input.name,
    expectedSerialized: input.guard.serialized,
    expectedContentDigest: input.guard.contentDigest,
    maximumBytes: MAX_LM2_QUOTA_LEDGER_BYTES,
  });
  const current = createLm2LedgerGuard({
    read,
    workspaceKey: input.workspaceKey,
    expected: input.guard.ledger,
  });
  if (!sameFileIdentity(current.stat, input.guard.stat)) {
    throw new Lm2Error("index_lock_unavailable", "LM2 ledger identity changed.");
  }
}
