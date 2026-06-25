import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonDir, discoveryPath, lockPath } from "../src/paths.js";

describe("daemon paths", () => {
  it("nests daemon files under <storeRoot>/daemon", () => {
    expect(daemonDir("/s")).toBe(join("/s", "daemon"));
    expect(discoveryPath("/s")).toBe(join("/s", "daemon", "daemon.json"));
    expect(lockPath("/s")).toBe(join("/s", "daemon", "daemon.lock"));
  });
});
