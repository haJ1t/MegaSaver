import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { BrainSyncError } from "../src/errors.js";
import {
  MANIFEST_AAD,
  type SyncManifest,
  objectAad,
  openManifest,
  sealManifest,
} from "../src/manifest.js";

const key = randomBytes(32);
const manifest: SyncManifest = {
  schemaVersion: 1,
  generation: 3,
  updatedAt: "2026-07-11T12:00:00.000Z",
  brainSha256: "a".repeat(64),
  objectKey: `objects/${randomUUID()}.enc`,
};

describe("sync manifest", () => {
  it("seal/open round-trips", () => {
    expect(openManifest(sealManifest(manifest, key), key)).toEqual(manifest);
  });

  it("seal uses the manifest AAD (decrypt with object AAD fails)", () => {
    const sealed = sealManifest(manifest, key);
    expect(() => decrypt(sealed, key, objectAad("objects/x.enc"))).toThrow(BrainSyncError);
    expect(() => decrypt(sealed, key, MANIFEST_AAD)).not.toThrow();
  });

  it("open rejects valid-JSON payloads that fail the schema", () => {
    const bad = encrypt(
      new TextEncoder().encode(JSON.stringify({ nope: true })),
      key,
      MANIFEST_AAD,
    );
    try {
      openManifest(bad, key);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("open rejects non-JSON plaintext", () => {
    const bad = encrypt(new TextEncoder().encode("not json at all"), key, MANIFEST_AAD);
    try {
      openManifest(bad, key);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("objectAad binds the object key", () => {
    expect(objectAad("objects/abc.enc")).toBe("megasaver-brain-sync:v1:object:objects/abc.enc");
    expect(MANIFEST_AAD).toBe("megasaver-brain-sync:v1:manifest");
  });
});
