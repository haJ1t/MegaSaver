import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrainSyncError } from "../src/errors.js";
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateKey,
  loadKeyfile,
  saveKeyfile,
} from "../src/keyfile.js";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "brain-sync-key-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("keyfile", () => {
  it("generates 32-byte keys", () => {
    expect(generateKey().length).toBe(32);
  });

  it("save/load round-trips and sets 0600", () => {
    const path = join(tempDir(), "brain-sync.key");
    const key = generateKey();
    saveKeyfile(path, key);
    expect(loadKeyfile(path)).toEqual(key);
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("loadKeyfile: missing file -> keyfile_missing", () => {
    try {
      loadKeyfile(join(tempDir(), "nope.key"));
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("keyfile_missing");
    }
  });

  it("loadKeyfile: wrong length -> keyfile_invalid", () => {
    const path = join(tempDir(), "brain-sync.key");
    saveKeyfile(path, generateKey());
    saveKeyfile(path, Uint8Array.from([1, 2, 3, 4, 5]));
    try {
      loadKeyfile(path);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("keyfile_invalid");
    }
  });

  it("recovery code round-trips (55 chars, dash groups of 5)", () => {
    const key = generateKey();
    const code = encodeRecoveryCode(key);
    expect(code.replaceAll("-", "")).toHaveLength(55);
    expect(code.split("-").every((g) => g.length === 5)).toBe(true);
    expect(decodeRecoveryCode(code)).toEqual(key);
    expect(decodeRecoveryCode(code.toLowerCase())).toEqual(key);
  });

  it("recovery code: single-character typo -> bad_recovery_code", () => {
    const code = encodeRecoveryCode(generateKey());
    const flipped = (code[0] === "A" ? "B" : "A") + code.slice(1);
    try {
      decodeRecoveryCode(flipped);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("bad_recovery_code");
    }
  });

  it("recovery code: dropped character (truncated) -> bad_recovery_code via length guard", () => {
    const code = encodeRecoveryCode(generateKey());
    const compact = code.replaceAll("-", "");
    const truncated = compact.slice(0, compact.length - 1); // 54 chars -> 33 bytes
    try {
      decodeRecoveryCode(truncated);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("bad_recovery_code");
    }
  });

  it("recovery code: empty string -> bad_recovery_code", () => {
    try {
      decodeRecoveryCode("");
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("bad_recovery_code");
    }
  });

  it("recovery code: tolerates embedded spaces", () => {
    const key = generateKey();
    const spaced = encodeRecoveryCode(key).replaceAll("-", " ");
    expect(decodeRecoveryCode(spaced)).toEqual(key);
  });
});
