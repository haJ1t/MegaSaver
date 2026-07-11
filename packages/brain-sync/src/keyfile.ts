import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { atomicWriteFile } from "./atomic-write.js";
import { base32Decode, base32Encode } from "./base32.js";
import { BrainSyncError } from "./errors.js";
import { sha256Bytes } from "./hash.js";

export const KEY_LENGTH = 32;
const CHECKSUM_LENGTH = 2;

export function generateKey(): Uint8Array {
  // Normalize to a plain Uint8Array: randomBytes() returns a Buffer, which
  // Vitest's deep-equal treats as distinct from the Uint8Array instances
  // loadKeyfile/decodeRecoveryCode return, even with identical bytes.
  return Uint8Array.from(randomBytes(KEY_LENGTH));
}

export function saveKeyfile(path: string, key: Uint8Array): void {
  atomicWriteFile(path, key, { mode: 0o600 });
}

export function loadKeyfile(path: string): Uint8Array {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BrainSyncError(
        "keyfile_missing",
        `no keyfile at ${path} — run \`mega brain sync init\``,
      );
    }
    throw err;
  }
  if (raw.length !== KEY_LENGTH) {
    throw new BrainSyncError(
      "keyfile_invalid",
      `keyfile at ${path} is ${raw.length} bytes, expected ${KEY_LENGTH}`,
    );
  }
  return Uint8Array.from(raw);
}

export function encodeRecoveryCode(key: Uint8Array): string {
  const checksum = sha256Bytes(key).subarray(0, CHECKSUM_LENGTH);
  const encoded = base32Encode(Buffer.concat([Buffer.from(key), checksum]));
  return encoded.match(/.{1,5}/g)?.join("-") ?? encoded;
}

export function decodeRecoveryCode(code: string): Uint8Array {
  const compact = code.replaceAll("-", "").replaceAll(/\s/g, "").toUpperCase();
  const bytes = base32Decode(compact);
  if (bytes.length !== KEY_LENGTH + CHECKSUM_LENGTH) {
    throw new BrainSyncError("bad_recovery_code", "recovery code has the wrong length");
  }
  const key = bytes.subarray(0, KEY_LENGTH);
  const checksum = bytes.subarray(KEY_LENGTH);
  const expected = sha256Bytes(key).subarray(0, CHECKSUM_LENGTH);
  if (!Buffer.from(checksum).equals(expected)) {
    throw new BrainSyncError(
      "bad_recovery_code",
      "recovery code checksum does not match — check for typos",
    );
  }
  return Uint8Array.from(key);
}
