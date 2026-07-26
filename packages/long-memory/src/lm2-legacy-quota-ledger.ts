import { type Lm2QuotaLedger, lm2QuotaLedgerSchema } from "./lm2-quota-ledger.js";

type LegacyIdentity = { device: string; inode: string };

function legacyIdentityText(input: unknown): LegacyIdentity | null {
  if (typeof input !== "object" || input === null) return null;
  const identity = input as { device?: unknown; inode?: unknown };
  if (
    typeof identity.device !== "number" ||
    !Number.isSafeInteger(identity.device) ||
    identity.device < 0 ||
    typeof identity.inode !== "number" ||
    !Number.isSafeInteger(identity.inode) ||
    identity.inode < 0
  ) {
    return null;
  }
  return { device: identity.device.toString(), inode: identity.inode.toString() };
}

function normalizeLegacyQuotaLedger(source: unknown): Lm2QuotaLedger | null {
  if (typeof source !== "object" || source === null) return null;
  const ledger = source as { activeOperation?: unknown; lockIdentity?: unknown } & Record<
    string,
    unknown
  >;
  const lockIdentity = legacyIdentityText(ledger.lockIdentity);
  if (lockIdentity === null) return null;
  const active = ledger.activeOperation;
  if (active !== null && (typeof active !== "object" || active === null)) return null;
  const activeIdentity =
    active === null
      ? null
      : legacyIdentityText((active as { lockIdentity?: unknown }).lockIdentity);
  if (active !== null && activeIdentity === null) return null;
  const normalized = lm2QuotaLedgerSchema.safeParse({
    ...ledger,
    lockIdentity,
    activeOperation:
      active === null
        ? null
        : {
            ...(active as Record<string, unknown>),
            lockIdentity: activeIdentity,
          },
  });
  return normalized.success ? normalized.data : null;
}

function serializeLegacyLm2QuotaLedger(ledger: Lm2QuotaLedger): string {
  return `${JSON.stringify({
    ...ledger,
    lockIdentity: {
      device: Number(ledger.lockIdentity.device),
      inode: Number(ledger.lockIdentity.inode),
    },
    activeOperation:
      ledger.activeOperation === null
        ? null
        : {
            ...ledger.activeOperation,
            lockIdentity: {
              device: Number(ledger.activeOperation.lockIdentity.device),
              inode: Number(ledger.activeOperation.lockIdentity.inode),
            },
          },
  })}\n`;
}

export function parseCanonicalLegacyLm2QuotaLedger(
  source: unknown,
  raw: string,
): Lm2QuotaLedger | null {
  const ledger = normalizeLegacyQuotaLedger(source);
  return ledger !== null && serializeLegacyLm2QuotaLedger(ledger) === raw ? ledger : null;
}
