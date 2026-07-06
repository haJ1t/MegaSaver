import { type KeyObject, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyLicense } from "./license.js";

const LICENSE_FILE = "license.json";

export type StoredLicense = {
  key: string;
  activatedAt: string;
};

export type ActivateLicenseDeps = {
  publicKey: KeyObject | string;
  now: () => number;
  activatedAt?: () => string;
};

export type ActivateLicenseResult =
  | { ok: true; tier: "pro"; expiresAt: string | null }
  | { ok: false; reason: "invalid_signature" | "expired" | "malformed" };

export type LicenseStatusDeps = {
  publicKey: KeyObject | string;
  now: () => number;
};

export type LicenseStatusResult =
  | { active: true; tier: "pro"; expiresAt: string | null }
  | {
      active: false;
      reason: "no_license" | "expired" | "invalid_signature" | "malformed";
    };

function licensePath(storeRoot: string): string {
  return join(storeRoot, LICENSE_FILE);
}

function atomicWrite(filePath: string, content: string): void {
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`);
  writeFileSync(tempPath, content);
  renameSync(tempPath, filePath);
}

// Activation verifies BEFORE persisting: an invalid/forged/expired/malformed key
// is rejected and NOTHING is written. Only a signature-valid, unexpired license
// reaches disk.
export function activateLicense(
  storeRoot: string,
  key: string,
  deps: ActivateLicenseDeps,
): ActivateLicenseResult {
  const verified = verifyLicense(key, { publicKey: deps.publicKey, now: deps.now });
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }

  const activatedAt = (deps.activatedAt ?? (() => new Date().toISOString()))();
  const record: StoredLicense = { key, activatedAt };
  mkdirSync(storeRoot, { recursive: true });
  atomicWrite(licensePath(storeRoot), JSON.stringify(record));

  return { ok: true, tier: verified.tier, expiresAt: verified.expiresAt };
}

// Best-effort read: a missing or corrupt license file resolves to null rather
// than throwing.
export function readLicense(storeRoot: string): StoredLicense | null {
  let raw: string;
  try {
    raw = readFileSync(licensePath(storeRoot), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const { key, activatedAt } = parsed as { key?: unknown; activatedAt?: unknown };
    if (typeof key !== "string" || key.length === 0) return null;
    if (typeof activatedAt !== "string") return null;
    return { key, activatedAt };
  } catch {
    return null;
  }
}

export function deactivateLicense(storeRoot: string): void {
  rmSync(licensePath(storeRoot), { force: true });
}

export function licenseStatus(storeRoot: string, deps: LicenseStatusDeps): LicenseStatusResult {
  const stored = readLicense(storeRoot);
  if (stored === null) return { active: false, reason: "no_license" };
  const verified = verifyLicense(stored.key, { publicKey: deps.publicKey, now: deps.now });
  if (verified.valid) {
    return { active: true, tier: verified.tier, expiresAt: verified.expiresAt };
  }
  return { active: false, reason: verified.reason };
}
