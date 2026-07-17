import type { KeyObject } from "node:crypto";
import { verifyLicense } from "./license.js";
import { MEGASAVER_PUBLIC_KEY } from "./public-key.js";
import { readLicenseFile } from "./store.js";

export type ProFeature =
  | "savings-analytics"
  | "brain-portability"
  | "code-truth"
  | "brain-autopilot";

export type EntitlementDeps = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
};

export type EntitlementResult =
  | { entitled: true; tier: "pro"; expiresAt: string | null }
  | {
      entitled: false;
      reason: "no_license" | "expired" | "invalid_signature" | "malformed";
    };

function readStoredKey(storeRoot: string): { key: string } | null | "corrupt" {
  const raw = readLicenseFile(storeRoot);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return "corrupt";
    const { key } = parsed as { key?: unknown };
    if (typeof key !== "string" || key.length === 0) return "corrupt";
    return { key };
  } catch {
    return "corrupt";
  }
}

// Fail-closed entitlement gate. Anything unverifiable — no license, corrupt
// store, forged/tampered/expired key — resolves to { entitled:false }.
export function checkEntitlement(_feature: ProFeature, deps: EntitlementDeps): EntitlementResult {
  const stored = readStoredKey(deps.storeRoot);
  if (stored === null) return { entitled: false, reason: "no_license" };
  if (stored === "corrupt") return { entitled: false, reason: "malformed" };

  const result = verifyLicense(stored.key, {
    publicKey: deps.publicKey ?? MEGASAVER_PUBLIC_KEY,
    now: deps.now,
  });
  if (result.valid) {
    return { entitled: true, tier: result.tier, expiresAt: result.expiresAt };
  }
  return { entitled: false, reason: result.reason };
}
