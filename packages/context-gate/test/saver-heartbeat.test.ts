import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readHeartbeatView,
  recordCompressionHeartbeat,
  recordInvocationHeartbeat,
} from "../src/saver-heartbeat.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-hb-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe("invocation heartbeat", () => {
  it("records a workspace and derives latest", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces.aaaa).toBe(iso(NOW));
    expect(v.latest).toEqual({ ts: iso(NOW), workspaceKey: "aaaa" });
  });

  it("is strict-newer per key (older is a no-op)", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordInvocationHeartbeat(store, "aaaa", iso(NOW - 5000), NOW);
    expect(readHeartbeatView(store, NOW).workspaces.aaaa).toBe(iso(NOW));
  });

  it("never moves latest backward on clock regression", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordInvocationHeartbeat(store, "bbbb", iso(NOW - 10_000), NOW);
    expect(readHeartbeatView(store, NOW).latest).toEqual({ ts: iso(NOW), workspaceKey: "aaaa" });
  });

  it("rejects a >5-minute future skew", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW + 6 * 60_000), NOW);
    expect(readHeartbeatView(store, NOW).workspaces.aaaa).toBeUndefined();
    expect(readHeartbeatView(store, NOW).latest).toBeNull();
  });

  it("prunes entries older than 30 days", () => {
    recordInvocationHeartbeat(store, "old", iso(NOW - 31 * 86_400_000), NOW - 31 * 86_400_000);
    recordInvocationHeartbeat(store, "new", iso(NOW), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces.old).toBeUndefined();
    expect(v.workspaces.new).toBe(iso(NOW));
  });

  it("caps at 256 newest workspaces", () => {
    for (let i = 0; i < 260; i++)
      recordInvocationHeartbeat(store, `w${i}`, iso(NOW - (260 - i)), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(Object.keys(v.workspaces).length).toBe(256);
    expect(v.workspaces.w0).toBeUndefined(); // oldest evicted
    expect(v.workspaces.w259).toBe(iso(NOW - 1));
  });
});

describe("compression heartbeat", () => {
  it("sets latestCompression and is strict-newer", () => {
    recordCompressionHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).latestCompression).toEqual({
      ts: iso(NOW),
      workspaceKey: "aaaa",
    });
    recordCompressionHeartbeat(store, "bbbb", iso(NOW - 5000), NOW); // older, ignored
    expect(readHeartbeatView(store, NOW).latestCompression).toEqual({
      ts: iso(NOW),
      workspaceKey: "aaaa",
    });
  });

  it("does not move latestCompression backward on clock regression", () => {
    recordCompressionHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordCompressionHeartbeat(store, "bbbb", iso(NOW - 100_000), NOW);
    expect(readHeartbeatView(store, NOW).latestCompression?.workspaceKey).toBe("aaaa");
  });

  it("is independent from invocation latest", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).latestCompression).toBeNull();
  });
});

describe("hardening", () => {
  it("writes the registry file 0600", () => {
    if (process.platform === "win32") return;
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    const st = statSync(join(store, "stats", "saver-hook-heartbeats.json"));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("readHeartbeatView does not mutate the file", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    const path = join(store, "stats", "saver-hook-heartbeats.json");
    const before = readFileSync(path, "utf8");
    readHeartbeatView(store, NOW);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("missing registry reads as empty", () => {
    expect(readHeartbeatView(store, NOW)).toEqual({
      latest: null,
      latestCompression: null,
      workspaces: {},
    });
  });
});
