import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLicense } from "../src/license.js";

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

function keypair() {
  return generateKeyPairSync("ed25519");
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

describe("verifyLicense", () => {
  it("accepts a valid, non-expiring pro license", () => {
    const { publicKey, privateKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: null,
    });

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: true,
      tier: "pro",
      expiresAt: null,
    });
  });

  it("accepts a valid license that expires in the future and reports expiresAt", () => {
    const { publicKey, privateKey } = keypair();
    const expSec = Math.floor(NOW_MS / 1000) + 3600;
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: expSec,
    });

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: true,
      tier: "pro",
      expiresAt: new Date(expSec * 1000).toISOString(),
    });
  });

  it("rejects a tampered payload byte as invalid_signature", () => {
    const { publicKey, privateKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: null,
    });
    const dot = key.indexOf(".");
    const prefixPayload = key.slice(0, dot);
    const sig = key.slice(dot + 1);
    // Flip one character of the b64url payload segment (after the msp_ prefix).
    const chars = prefixPayload.split("");
    const flipAt = "msp_".length + 2;
    chars[flipAt] = chars[flipAt] === "A" ? "B" : "A";
    const tampered = `${chars.join("")}.${sig}`;

    expect(verifyLicense(tampered, { publicKey, now })).toEqual({
      valid: false,
      reason: "invalid_signature",
    });
  });

  it("rejects a license signed by a different keypair as invalid_signature", () => {
    const { privateKey } = keypair();
    const { publicKey: otherPublicKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: null,
    });

    expect(verifyLicense(key, { publicKey: otherPublicKey, now })).toEqual({
      valid: false,
      reason: "invalid_signature",
    });
  });

  it("rejects an expired license", () => {
    const { publicKey, privateKey } = keypair();
    const expSec = Math.floor(NOW_MS / 1000) - 1;
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: expSec,
    });

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("treats a token without the msp_ prefix as malformed", () => {
    const { publicKey } = keypair();
    expect(verifyLicense("nope_abc.def", { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats a token with no dot separator as malformed", () => {
    const { publicKey } = keypair();
    expect(verifyLicense("msp_abcdef", { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats a non-JSON payload as malformed", () => {
    const { publicKey, privateKey } = keypair();
    const payloadBytes = Buffer.from("not-json-at-all");
    const sig = sign(null, payloadBytes, privateKey);
    const key = `msp_${b64url(payloadBytes)}.${b64url(sig)}`;

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats a wrong-version payload as malformed", () => {
    const { publicKey, privateKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 2,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: null,
    });

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats an unknown tier as malformed", () => {
    const { publicKey, privateKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "enterprise",
      id: "x",
      iat: 0,
      exp: null,
    });

    expect(verifyLicense(key, { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("treats an empty string as malformed (fail-closed)", () => {
    const { publicKey } = keypair();
    expect(verifyLicense("", { publicKey, now })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("fails closed (not entitled) when the verify body throws", () => {
    // A well-formed msp_ token clears every pre-verify guard and reaches
    // createPublicKey, which throws on this non-PEM key string. The load-bearing
    // catch must swallow the throw and resolve to NOT entitled — never fail open.
    const { privateKey } = keypair();
    const key = signTestLicense(privateKey, {
      v: 1,
      tier: "pro",
      id: "x",
      iat: 0,
      exp: null,
    });
    const brokenPublicKey = "-----BEGIN PUBLIC KEY-----\nnotbase64\n-----END PUBLIC KEY-----";

    const result = verifyLicense(key, { publicKey: brokenPublicKey, now });

    expect(result.valid).toBe(false);
  });
});
