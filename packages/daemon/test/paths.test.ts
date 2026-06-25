import { describe, expect, it } from "vitest";
import { daemonDir, discoveryPath, lockPath } from "../src/paths.js";

describe("daemon paths", () => {
  it("nests daemon files under <storeRoot>/daemon", () => {
    expect(daemonDir("/s")).toBe("/s/daemon");
    expect(discoveryPath("/s")).toBe("/s/daemon/daemon.json");
    expect(lockPath("/s")).toBe("/s/daemon/daemon.lock");
  });
});
