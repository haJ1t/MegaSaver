import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiscovery, readDiscovery, writeDiscovery } from "../src/discovery.js";
import { discoveryPath } from "../src/paths.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-disc-"));
  mkdirSync(join(store, "daemon"), { recursive: true });
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

describe("discovery", () => {
  it("round-trips a record", () => {
    writeDiscovery(store, { port: 1234, token: "t", pid: 99, startedAt: "2026-06-25T00:00:00Z" });
    expect(readDiscovery(store)).toEqual({
      port: 1234,
      token: "t",
      pid: 99,
      startedAt: "2026-06-25T00:00:00Z",
    });
  });

  it("returns null when the file is missing", () => {
    expect(readDiscovery(store)).toBeNull();
  });

  it("returns null when the file is corrupt", () => {
    writeFileSync(discoveryPath(store), "not json");
    expect(readDiscovery(store)).toBeNull();
  });

  it("clear removes the file", () => {
    writeDiscovery(store, { port: 1, token: "t", pid: 1, startedAt: "x" });
    clearDiscovery(store);
    expect(readDiscovery(store)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "writes the discovery file with owner-only (0o600) permissions",
    () => {
      writeDiscovery(store, { port: 1, token: "secret", pid: 1, startedAt: "x" });
      expect(statSync(discoveryPath(store)).mode & 0o777).toBe(0o600);
    },
  );
});
