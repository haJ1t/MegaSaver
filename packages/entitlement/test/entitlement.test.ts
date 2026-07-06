import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEntitlement } from "../src/entitlement.js";

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

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-ent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeLicense(key: string): void {
  writeFileSync(
    join(root, "license.json"),
    JSON.stringify({ key, activatedAt: "2026-07-06T00:00:00.000Z" }),
  );
}

describe("checkEntitlement", () => {
  it("returns not entitled with no_license when no license file exists", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    expect(checkEntitlement("savings-analytics", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "no_license",
    });
  });

  it("returns entitled for a stored valid license", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    writeLicense(signTestLicense(privateKey, { v: 1, tier: "pro", id: "x", iat: 0, exp: null }));
    expect(checkEntitlement("savings-analytics", { storeRoot: root, now, publicKey })).toEqual({
      entitled: true,
      tier: "pro",
      expiresAt: null,
    });
  });

  it("returns not entitled with invalid_signature for a stored forged license", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const { privateKey: otherPriv } = generateKeyPairSync("ed25519");
    writeLicense(signTestLicense(otherPriv, { v: 1, tier: "pro", id: "x", iat: 0, exp: null }));
    expect(checkEntitlement("savings-analytics", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "invalid_signature",
    });
  });

  it("returns not entitled with expired for a stored expired license", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const expSec = Math.floor(NOW_MS / 1000) - 1;
    writeLicense(signTestLicense(privateKey, { v: 1, tier: "pro", id: "x", iat: 0, exp: expSec }));
    expect(checkEntitlement("savings-analytics", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "expired",
    });
  });

  it("returns not entitled with malformed when the license file is corrupt JSON", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(join(root, "license.json"), "{ this is not json");
    expect(checkEntitlement("savings-analytics", { storeRoot: root, now, publicKey })).toEqual({
      entitled: false,
      reason: "malformed",
    });
  });

  it("fails closed (not entitled) when verify throws on a stored key", () => {
    // A signature-valid stored key reaches verifyLicense, which throws while
    // building the (broken) public key. The seam must stay fail-closed.
    const { privateKey } = generateKeyPairSync("ed25519");
    writeLicense(signTestLicense(privateKey, { v: 1, tier: "pro", id: "x", iat: 0, exp: null }));
    const brokenPublicKey = "-----BEGIN PUBLIC KEY-----\nnotbase64\n-----END PUBLIC KEY-----";

    const result = checkEntitlement("savings-analytics", {
      storeRoot: root,
      now,
      publicKey: brokenPublicKey,
    });

    expect(result.entitled).toBe(false);
  });
});
