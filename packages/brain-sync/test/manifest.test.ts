import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import type { BrainSyncError } from "../src/errors.js";
import {
  type SyncManifest,
  manifestAad,
  objectAad,
  openManifest,
  sealManifest,
} from "../src/manifest.js";

const key = randomBytes(32);
const projectId = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";
const otherProjectId = "9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const manifest: SyncManifest = {
  schemaVersion: 1,
  generation: 3,
  updatedAt: "2026-07-11T12:00:00.000Z",
  brainSha256: "a".repeat(64),
  objectKey: `objects/${randomUUID()}.enc`,
};

describe("sync manifest", () => {
  it("seal/open round-trips under the same projectId", () => {
    expect(openManifest(sealManifest(manifest, key, projectId), key, projectId)).toEqual(manifest);
  });

  it("seal uses the manifest AAD (decrypt with object AAD fails)", () => {
    const sealed = sealManifest(manifest, key, projectId);
    expect(() => decrypt(sealed, key, objectAad(projectId, "objects/x.enc"))).toThrow();
    expect(() => decrypt(sealed, key, manifestAad(projectId))).not.toThrow();
  });

  it("rejects a manifest transplanted to a different project (cross-project)", () => {
    const sealed = sealManifest(manifest, key, projectId);
    expect(() => openManifest(sealed, key, otherProjectId)).toThrow();
  });

  it("open rejects valid-JSON payloads that fail the schema", () => {
    const bad = encrypt(
      new TextEncoder().encode(JSON.stringify({ nope: true })),
      key,
      manifestAad(projectId),
    );
    try {
      openManifest(bad, key, projectId);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("open rejects non-JSON plaintext", () => {
    const bad = encrypt(new TextEncoder().encode("not json at all"), key, manifestAad(projectId));
    try {
      openManifest(bad, key, projectId);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("manifest_invalid");
    }
  });

  it("aad helpers produce the bound strings", () => {
    expect(manifestAad(projectId)).toBe(`megasaver-brain-sync:v1:manifest:${projectId}`);
    expect(objectAad(projectId, "objects/abc.enc")).toBe(
      `megasaver-brain-sync:v1:object:${projectId}:objects/abc.enc`,
    );
  });

  it("rejects an extra field (strict schema)", () => {
    const bad = encrypt(
      new TextEncoder().encode(JSON.stringify({ ...manifest, extra: 1 })),
      key,
      manifestAad(projectId),
    );
    expect(() => openManifest(bad, key, projectId)).toThrow();
  });

  it("rejects generation 0, malformed objectKey, and uppercase brainSha256", () => {
    const seal = (m: unknown) =>
      encrypt(new TextEncoder().encode(JSON.stringify(m)), key, manifestAad(projectId));
    expect(() => openManifest(seal({ ...manifest, generation: 0 }), key, projectId)).toThrow();
    expect(() =>
      openManifest(seal({ ...manifest, objectKey: "objects/../evil.enc" }), key, projectId),
    ).toThrow();
    expect(() =>
      openManifest(seal({ ...manifest, brainSha256: "A".repeat(64) }), key, projectId),
    ).toThrow();
  });
});
