import { type KeyObject, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyLicense } from "./license.js";

export const LICENSE_FILE = "license.json";

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
      reason: "no_license" | "corrupt" | "expired" | "invalid_signature" | "malformed";
    };

function licensePath(storeRoot: string): string {
  return join(storeRoot, LICENSE_FILE);
}

// Single source of the license-file read: a missing file resolves to null; the
// raw string is returned otherwise. Callers own their own JSON parsing.
export function readLicenseFile(storeRoot: string): string | null {
  try {
    return readFileSync(licensePath(storeRoot), "utf8");
  } catch {
    return null;
  }
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
  const raw = readLicenseFile(storeRoot);
  if (raw === null) return null;
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

// A corrupt file (present but unreadable/invalid) is reported distinctly from a
// truly absent one, so `mega license status` surfaces "present but invalid"
// instead of hiding a broken license as "no license". checkEntitlement stays
// fail-closed independently — this only affects the human-facing status.
export function licenseStatus(storeRoot: string, deps: LicenseStatusDeps): LicenseStatusResult {
  const raw = readLicenseFile(storeRoot);
  if (raw === null) return { active: false, reason: "no_license" };
  const stored = readLicense(storeRoot);
  if (stored === null) return { active: false, reason: "corrupt" };
  const verified = verifyLicense(stored.key, { publicKey: deps.publicKey, now: deps.now });
  if (verified.valid) {
    return { active: true, tier: verified.tier, expiresAt: verified.expiresAt };
  }
  return { active: false, reason: verified.reason };
}
