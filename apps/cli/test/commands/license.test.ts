import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runLicenseActivate,
  runLicenseDeactivate,
  runLicenseStatus,
} from "../../src/commands/license.js";

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
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-license-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function validKey(): string {
  return signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "cust-1", iat: 0, exp: null });
}

describe("runLicenseActivate", () => {
  it("activates a valid key, prints Pro activated, returns 0", () => {
    const code = runLicenseActivate({
      key: validKey(),
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro activated");
    expect(out.join("\n")).toContain("pro");
    expect(existsSync(join(root, "license.json"))).toBe(true);
  });

  it("rejects a forged key with an honest message, exit 1, writes nothing", () => {
    const { privateKey: otherPriv } = generateKeyPairSync("ed25519");
    const forged = signTestLicense(otherPriv, {
      v: 1,
      tier: "pro",
      id: "cust-1",
      iat: 0,
      exp: null,
    });

    const code = runLicenseActivate({
      key: forged,
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("invalid_signature");
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });

  it("rejects an expired key with exit 1 and writes nothing", () => {
    const expSec = Math.floor(NOW_MS / 1000) - 1;
    const expired = signTestLicense(keys.privateKey, {
      v: 1,
      tier: "pro",
      id: "cust-1",
      iat: 0,
      exp: expSec,
    });

    const code = runLicenseActivate({
      key: expired,
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("expired");
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });
});

describe("runLicenseStatus", () => {
  it("reports Pro (active) after a valid activation", () => {
    runLicenseActivate({
      key: validKey(),
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });
    out = [];

    const code = runLicenseStatus({
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Pro (active)");
  });

  it("reports no license (free) when none is stored", () => {
    const code = runLicenseStatus({
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no license (free)");
  });

  it("reports a corrupt license distinctly (present but invalid — re-activate)", () => {
    writeFileSync(join(root, "license.json"), "{ not json");

    const code = runLicenseStatus({
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    const text = out.join("\n");
    expect(code).toBe(0);
    // A broken license must NOT be hidden as "no license".
    expect(text).not.toContain("no license");
    expect(text).toContain("re-activate");
  });
});

describe("runLicenseDeactivate", () => {
  it("removes a stored license and reports it", () => {
    runLicenseActivate({
      key: validKey(),
      storeRoot: root,
      publicKey: keys.publicKey,
      now,
      stdout,
      stderr,
    });

    const code = runLicenseDeactivate({ storeRoot: root, stdout, stderr });

    expect(code).toBe(0);
    expect(existsSync(join(root, "license.json"))).toBe(false);
  });
});
