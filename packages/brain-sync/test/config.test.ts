import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeEndpoint,
  loadConfig,
  normalizePrefix,
  saveConfig,
  updateLastSeen,
} from "../src/config.js";
import type { BrainSyncError } from "../src/errors.js";

const dirs: string[] = [];
const tempStore = () => {
  const d = mkdtempSync(join(tmpdir(), "brain-sync-cfg-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const validConfig = {
  schemaVersion: 1,
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  bucket: "my-brain",
  prefix: "megasaver-brain/",
  region: "auto",
  pathStyle: true,
  conditionalWritesVerified: true,
  lastSeen: {},
} as const;

describe("config", () => {
  it("save/load round-trips", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    expect(loadConfig(store)).toEqual(validConfig);
  });

  it("missing config -> config_invalid with init hint", () => {
    try {
      loadConfig(tempStore());
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("config_invalid");
      expect((err as BrainSyncError).message).toContain("mega brain sync init");
    }
  });

  it("rejects unknown fields (strict schema)", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    saveConfig(store, { ...validConfig, extra: 1 } as never);
    try {
      loadConfig(store);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("config_invalid");
    }
  });

  it("updateLastSeen persists per project id", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    const pid = "3b6c1c8e-0f4c-4d6a-9b3e-2f8a1c9d7e5f";
    updateLastSeen(store, pid, 4);
    expect(loadConfig(store).lastSeen[pid]).toBe(4);
  });

  it("updateLastSeen rejects non-uuid project id without bricking config", () => {
    const store = tempStore();
    saveConfig(store, validConfig);
    try {
      updateLastSeen(store, "not-a-uuid", 1);
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("config_invalid");
    }
    expect(loadConfig(store)).toEqual(validConfig);
  });

  it("assertSafeEndpoint: https ok, http localhost ok, http remote rejected", () => {
    expect(() => assertSafeEndpoint("https://s3.example.com")).not.toThrow();
    expect(() => assertSafeEndpoint("http://127.0.0.1:9000")).not.toThrow();
    expect(() => assertSafeEndpoint("http://localhost:9000")).not.toThrow();
    expect(() => assertSafeEndpoint("http://[::1]:9000")).not.toThrow();
    for (const bad of [
      "http://s3.example.com",
      "HTTP://S3.EXAMPLE.COM",
      "http://localhost@evil.com",
      "http://localhost.evil.com",
    ]) {
      try {
        assertSafeEndpoint(bad);
        expect.unreachable();
      } catch (err) {
        expect((err as BrainSyncError).code).toBe("insecure_endpoint");
      }
    }
  });

  it("normalizePrefix ensures single trailing slash, strips leading slash", () => {
    expect(normalizePrefix("megasaver-brain")).toBe("megasaver-brain/");
    expect(normalizePrefix("/a/b/")).toBe("a/b/");
    expect(normalizePrefix("")).toBe("");
  });
});
