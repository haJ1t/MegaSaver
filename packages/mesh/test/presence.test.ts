import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heartbeat, listPeers, registerSession } from "../src/presence.js";

describe("presence", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mesh-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("register then list finds peer, dead filtered after 10m", () => {
    const now = Date.now();
    const rec = {
      liveSessionId: "s1",
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date(now).toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    };
    registerSession(root, rec);
    expect(listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" })).toHaveLength(1);
    const old = {
      ...rec,
      liveSessionId: "s2",
      lastSeenAt: new Date(now - 11 * 60 * 1000).toISOString(),
    };
    registerSession(root, old);
    expect(
      listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" }).map((r) => r.liveSessionId),
    ).toEqual(["s1"]);
  });

  it("future skew treated as live", () => {
    const now = Date.now();
    const future = {
      liveSessionId: "s1",
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date(now + 60 * 1000).toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    };
    registerSession(root, future);
    expect(listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" })).toHaveLength(1);
  });

  it("heartbeat debounces by mtime >=5s", async () => {
    const now = Date.now();
    const rec = {
      liveSessionId: "s1",
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date(now).toISOString(),
      workspaceKey: "aaaaaaaaaaaaaaaa",
      cwd: "/repo",
    };
    registerSession(root, rec);
    const before = listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" })[0]?.lastSeenAt;
    // immediate heartbeat should debounce (no change)
    heartbeat(root, "s1");
    const afterQuick = listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" })[0]?.lastSeenAt;
    expect(afterQuick).toBe(before);
  });

  it("quarantines corrupt presence file", async () => {
    const { mkdirSync, writeFileSync, readdirSync, existsSync } = await import("node:fs");
    const { meshPaths } = await import("../src/paths.js");
    const { presenceDir, quarantineDir } = meshPaths(root);
    mkdirSync(presenceDir, { recursive: true });
    writeFileSync(join(presenceDir, "bad.json"), "{ not json");
    expect(listPeers(root, { workspaceKey: "aaaaaaaaaaaaaaaa" })).toHaveLength(0);
    // corrupt file should be moved to quarantine
    expect(existsSync(join(presenceDir, "bad.json"))).toBe(false);
    expect(readdirSync(quarantineDir).length).toBe(1);
  });
});
