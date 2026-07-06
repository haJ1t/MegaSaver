import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activateLicense, deactivateLicense, licenseStatus, readLicense } from "../src/store.js";

type Payload = {
  v: number;
  tier: string;
  id: string;
  iat: number;
  exp: number | null;
};

const b64url = (buf: Buffer): string => buf.toString("base64url");

function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const sig = sign(null, payloadBytes, privateKey);
  return `msp_${b64url(payloadBytes)}.${b64url(sig)}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;
const ACTIVATED_AT = "2026-07-06T00:00:00.000Z";

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-store-"));
  keys = generateKeyPairSync("ed25519");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function validKey(): string {
  return signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "cust-1", iat: 0, exp: null });
}

describe("activateLicense", () => {
  it("verifies then writes license.json and returns ok for a valid key", () => {
    const key = validKey();
    const result = activateLicense(root, key, {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });

    expect(result).toEqual({ ok: true, tier: "pro", expiresAt: null });

    const stored = JSON.parse(readFileSync(join(root, "license.json"), "utf8"));
    expect(stored).toEqual({ key, activatedAt: ACTIVATED_AT });
  });

  it("rejects a forged key, returns the reason, and writes NOTHING", () => {
    const { privateKey: otherPriv } = generateKeyPairSync("ed25519");
    const forged = signTestLicense(otherPriv, {
      v: 1,
      tier: "pro",
      id: "cust-1",
      iat: 0,
      exp: null,
    });

    const result = activateLicense(root, forged, {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });

  it("rejects an expired key and writes NOTHING", () => {
    const expSec = Math.floor(NOW_MS / 1000) - 1;
    const key = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "cust-1",
      iat: 0,
      exp: expSec,
    });

    const result = activateLicense(root, key, {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });

  it("rejects a malformed key and writes NOTHING", () => {
    const result = activateLicense(root, "not-a-key", {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });

    expect(result).toEqual({ ok: false, reason: "malformed" });
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });
});

describe("readLicense", () => {
  it("returns the stored record after activation", () => {
    const key = validKey();
    activateLicense(root, key, { publicKey: keys.publicKey, now, activatedAt: () => ACTIVATED_AT });
    expect(readLicense(root)).toEqual({ key, activatedAt: ACTIVATED_AT });
  });

  it("returns null when no license is stored", () => {
    expect(readLicense(root)).toBeNull();
  });

  it("returns null when the license file is corrupt", () => {
    writeFileSync(join(root, "license.json"), "{ not json");
    expect(readLicense(root)).toBeNull();
  });
});

describe("deactivateLicense", () => {
  it("removes the stored license", () => {
    activateLicense(root, validKey(), {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });
    expect(readLicense(root)).not.toBeNull();

    deactivateLicense(root);

    expect(readLicense(root)).toBeNull();
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });

  it("is a no-op when no license exists", () => {
    expect(() => deactivateLicense(root)).not.toThrow();
    expect(readLicense(root)).toBeNull();
  });
});

describe("licenseStatus", () => {
  it("reports active + tier for a valid stored license", () => {
    activateLicense(root, validKey(), {
      publicKey: keys.publicKey,
      now,
      activatedAt: () => ACTIVATED_AT,
    });
    expect(licenseStatus(root, { publicKey: keys.publicKey, now })).toEqual({
      active: true,
      tier: "pro",
      expiresAt: null,
    });
  });

  it("reports none when no license is stored", () => {
    expect(licenseStatus(root, { publicKey: keys.publicKey, now })).toEqual({
      active: false,
      reason: "no_license",
    });
  });

  it("reports none with the reason for a stored expired license", () => {
    const expSec = Math.floor(NOW_MS / 1000) - 1;
    // Store the expired key directly (activation would reject it), then check status.
    const key = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "cust-1",
      iat: 0,
      exp: expSec,
    });
    // Round-trip via activate against a far-past clock so it stores, then check now.
    activateLicense(root, key, {
      publicKey: keys.publicKey,
      now: () => (expSec - 10) * 1000,
      activatedAt: () => ACTIVATED_AT,
    });
    expect(licenseStatus(root, { publicKey: keys.publicKey, now })).toEqual({
      active: false,
      reason: "expired",
    });
  });
});
