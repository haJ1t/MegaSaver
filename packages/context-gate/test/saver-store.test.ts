import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readExactRecord,
  readFamilyRecord,
  readGlobalDefault,
  withActivationLock,
  writeExactRecord,
  writeFamilyRecord,
  writeGlobalDefault,
} from "../src/saver-store.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-saverstore-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const WK = "0123456789abcdef";
const FK = `gf1_${"A".repeat(43)}`;
const DIGEST = "a".repeat(64);

describe("exact record", () => {
  it("round-trips a v1 exact record and classifies it as v1-exact", () => {
    writeExactRecord(store, WK, { enabled: true, mode: "aggressive", scope: "exact" });
    expect(readExactRecord(store, WK)).toEqual({
      kind: "v1-exact",
      enabled: true,
      mode: "aggressive",
    });
  });

  it("classifies both shipped legacy shapes as legacy", () => {
    const path = join(store, "stats", WK, "workspace-token-saver.json");
    mkdirSync(join(store, "stats", WK), { recursive: true });
    writeFileSync(path, JSON.stringify({ enabled: true, mode: "safe" }));
    expect(readExactRecord(store, WK)).toEqual({ kind: "legacy", enabled: true, mode: "safe" });
    writeFileSync(path, JSON.stringify({ enabled: false, mode: "balanced", updatedAt: "x" }));
    expect(readExactRecord(store, WK)).toEqual({
      kind: "legacy",
      enabled: false,
      mode: "balanced",
    });
  });

  it("returns absent when the file is missing", () => {
    expect(readExactRecord(store, WK)).toEqual({ kind: "absent" });
  });

  it("returns invalid for a malformed record", () => {
    mkdirSync(join(store, "stats", WK), { recursive: true });
    writeFileSync(join(store, "stats", WK, "workspace-token-saver.json"), "{not json");
    expect(readExactRecord(store, WK)).toEqual({ kind: "invalid" });
  });

  it("rejects an unsafe workspace key segment", () => {
    expect(() => readExactRecord(store, "../evil")).toThrow();
  });
});

describe("family record", () => {
  it("round-trips and requires a matching digest", () => {
    writeFamilyRecord(store, FK, {
      enabled: true,
      mode: "balanced",
      identityDigest: DIGEST,
      identityPath: "/repo/.git",
    });
    expect(readFamilyRecord(store, FK, DIGEST)).toEqual({ enabled: true, mode: "balanced" });
  });

  it("fails closed (invalid) on a digest mismatch", () => {
    writeFamilyRecord(store, FK, {
      enabled: true,
      mode: "balanced",
      identityDigest: DIGEST,
      identityPath: "/repo/.git",
    });
    expect(readFamilyRecord(store, FK, "b".repeat(64))).toBe("invalid");
  });

  it("returns null when absent", () => {
    expect(readFamilyRecord(store, FK, DIGEST)).toBeNull();
  });
});

describe("global default", () => {
  it("round-trips", () => {
    writeGlobalDefault(store, { enabled: true, mode: "safe" });
    expect(readGlobalDefault(store)).toEqual({ enabled: true, mode: "safe" });
  });

  it("returns null when absent", () => {
    expect(readGlobalDefault(store)).toBeNull();
  });
});

describe("hardening", () => {
  it("writes files 0600 under 0700 dirs", () => {
    if (process.platform === "win32") return;
    writeExactRecord(store, WK, { enabled: true, mode: "safe", scope: "exact" });
    const file = statSync(join(store, "stats", WK, "workspace-token-saver.json"));
    const dir = statSync(join(store, "stats", WK));
    expect(file.mode & 0o777).toBe(0o600);
    expect(dir.mode & 0o777).toBe(0o700);
  });

  it("refuses a symlinked record leaf (invalid)", () => {
    if (process.platform === "win32") return;
    mkdirSync(join(store, "stats", WK), { recursive: true });
    writeFileSync(join(store, "elsewhere.json"), JSON.stringify({ version: 1, enabled: true }));
    symlinkSync(
      join(store, "elsewhere.json"),
      join(store, "stats", WK, "workspace-token-saver.json"),
    );
    expect(readExactRecord(store, WK)).toEqual({ kind: "invalid" });
  });
});

describe("withActivationLock", () => {
  it("runs the critical section and releases", () => {
    const out = withActivationLock(store, () => 42);
    expect(out).toBe(42);
    // a second acquisition succeeds after release
    expect(withActivationLock(store, () => "ok")).toBe("ok");
  });

  it("recovers a stale lock left by a dead writer", () => {
    // Simulate a stale lock file older than the TTL.
    mkdirSync(join(store, "stats"), { recursive: true });
    const lock = join(store, "stats", ".saver-activation.lock");
    writeFileSync(lock, JSON.stringify({ pid: 999999, at: 0 }));
    // A dead writer's lock has an old mtime; backdate it past the TTL.
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect(withActivationLock(store, () => "recovered")).toBe("recovered");
  });
});
