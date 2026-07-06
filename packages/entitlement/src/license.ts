import { type KeyObject, createPublicKey, verify } from "node:crypto";

export type LicenseTier = "pro";

export type VerifyLicenseDeps = {
  publicKey: KeyObject | string;
  now: () => number;
};

export type VerifyLicenseResult =
  | { valid: true; tier: LicenseTier; expiresAt: string | null }
  | { valid: false; reason: "invalid_signature" | "expired" | "malformed" };

type LicensePayload = {
  v: 1;
  tier: "pro";
  id: string;
  iat: number;
  exp: number | null;
};

const KEY_PREFIX = "msp_";

function toKeyObject(key: KeyObject | string): KeyObject {
  return typeof key === "string" ? createPublicKey(key) : key;
}

type PayloadCandidate = {
  v?: unknown;
  tier?: unknown;
  id?: unknown;
  iat?: unknown;
  exp?: unknown;
};

function parsePayload(bytes: Buffer): LicensePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const { v, tier, id, iat, exp } = parsed as PayloadCandidate;
  if (v !== 1) return null;
  if (tier !== "pro") return null;
  if (typeof id !== "string") return null;
  if (typeof iat !== "number") return null;
  if (exp !== null && typeof exp !== "number") return null;
  return { v: 1, tier: "pro", id, iat, exp };
}

// Fail-closed: any parse error, decode error, verify failure, or field mismatch
// resolves to a { valid:false } result. A thrown error is never propagated to
// the caller — an unverifiable license is a non-entitled license.
export function verifyLicense(key: string, deps: VerifyLicenseDeps): VerifyLicenseResult {
  try {
    if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) {
      return { valid: false, reason: "malformed" };
    }
    const body = key.slice(KEY_PREFIX.length);
    const dot = body.indexOf(".");
    if (dot === -1) return { valid: false, reason: "malformed" };
    const payloadSegment = body.slice(0, dot);
    const sigSegment = body.slice(dot + 1);
    if (payloadSegment.length === 0 || sigSegment.length === 0) {
      return { valid: false, reason: "malformed" };
    }

    const payloadBytes = Buffer.from(payloadSegment, "base64url");
    const sigBytes = Buffer.from(sigSegment, "base64url");
    if (payloadBytes.length === 0 || sigBytes.length === 0) {
      return { valid: false, reason: "malformed" };
    }

    const publicKey = toKeyObject(deps.publicKey);
    const signatureOk = verify(null, payloadBytes, publicKey, sigBytes);
    if (!signatureOk) return { valid: false, reason: "invalid_signature" };

    const payload = parsePayload(payloadBytes);
    if (payload === null) return { valid: false, reason: "malformed" };

    if (payload.exp !== null) {
      const nowSec = Math.floor(deps.now() / 1000);
      if (payload.exp <= nowSec) return { valid: false, reason: "expired" };
    }

    return {
      valid: true,
      tier: payload.tier,
      expiresAt: payload.exp === null ? null : new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return { valid: false, reason: "malformed" };
  }
}
