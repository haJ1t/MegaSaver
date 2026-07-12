import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BrainSyncError } from "./errors.js";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encrypt(plaintext: Uint8Array, key: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function decrypt(blob: Uint8Array, key: Uint8Array, aad: string): Buffer {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new BrainSyncError("decrypt_failed", "encrypted blob is too short to be valid");
  }
  const buf = Buffer.from(blob);
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const body = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new BrainSyncError("decrypt_failed", `authentication failed for AAD ${aad}`);
  }
}
