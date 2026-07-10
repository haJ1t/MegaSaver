import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readHeartbeatView,
  recordCompletionHeartbeat,
  recordCompressionHeartbeat,
  recordDaemonFallbackHeartbeat,
  recordFailureHeartbeat,
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
    expect(v.workspaces).toHaveProperty("aaaa", iso(NOW));
    expect(v.latest).toEqual({ ts: iso(NOW), workspaceKey: "aaaa" });
  });

  it("is strict-newer per key (older is a no-op)", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordInvocationHeartbeat(store, "aaaa", iso(NOW - 5000), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).toHaveProperty("aaaa", iso(NOW));
  });

  it("never moves latest backward on clock regression", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordInvocationHeartbeat(store, "bbbb", iso(NOW - 10_000), NOW);
    expect(readHeartbeatView(store, NOW).latest).toEqual({ ts: iso(NOW), workspaceKey: "aaaa" });
  });

  it("rejects a >5-minute future skew", () => {
    recordInvocationHeartbeat(store, "aaaa", iso(NOW + 6 * 60_000), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).not.toHaveProperty("aaaa");
    expect(readHeartbeatView(store, NOW).latest).toBeNull();
  });

  it("prunes entries older than 30 days", () => {
    recordInvocationHeartbeat(store, "old", iso(NOW - 31 * 86_400_000), NOW - 31 * 86_400_000);
    recordInvocationHeartbeat(store, "new", iso(NOW), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces).not.toHaveProperty("old");
    expect(v.workspaces).toHaveProperty("new", iso(NOW));
  });

  it("caps at 256 newest workspaces", () => {
    for (let i = 0; i < 260; i++)
      recordInvocationHeartbeat(store, `w${i}`, iso(NOW - (260 - i)), NOW);
    const v = readHeartbeatView(store, NOW);
    expect(Object.keys(v.workspaces).length).toBe(256);
    expect(v.workspaces).not.toHaveProperty("w0"); // oldest evicted
    expect(v.workspaces).toHaveProperty("w259", iso(NOW - 1));
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

  it("drops non-string workspace values from a corrupt registry", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(
      join(store, "stats", "saver-hook-heartbeats.json"),
      JSON.stringify({ version: 1, workspaces: { good: iso(NOW), bad: 12345 } }),
    );
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces).toHaveProperty("good", iso(NOW));
    expect(v.workspaces).not.toHaveProperty("bad");
  });
});

describe("failure / completion / daemon-fallback ledger (E21)", () => {
  it("failure record increments count and keeps the newest lastAt/lastKind", () => {
    recordFailureHeartbeat(store, "aaaa", "record", iso(NOW - 1000), NOW);
    recordFailureHeartbeat(store, "aaaa", "payload", iso(NOW - 5000), NOW); // older ts still counts
    const v = readHeartbeatView(store, NOW);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["aaaa"]).toEqual({ count: 2, lastAt: iso(NOW - 1000), lastKind: "record" });
  });

  it("completion is strict-newer per key (older is a no-op)", () => {
    recordCompletionHeartbeat(store, "aaaa", iso(NOW), NOW);
    recordCompletionHeartbeat(store, "aaaa", iso(NOW - 5000), NOW);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(readHeartbeatView(store, NOW).completions?.["aaaa"]).toBe(iso(NOW));
  });

  it("daemon fallback counts and keeps the newest lastAt", () => {
    recordDaemonFallbackHeartbeat(store, "aaaa", iso(NOW - 2000), NOW);
    recordDaemonFallbackHeartbeat(store, "aaaa", iso(NOW - 1000), NOW);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(readHeartbeatView(store, NOW).daemonFallbacks?.["aaaa"]).toEqual({
      count: 2,
      lastAt: iso(NOW - 1000),
    });
  });

  it("prunes failure entries older than 30 days", () => {
    recordFailureHeartbeat(
      store,
      "old",
      "unknown",
      iso(NOW - 31 * 86_400_000),
      NOW - 31 * 86_400_000,
    );
    recordFailureHeartbeat(store, "new", "record", iso(NOW), NOW);
    const v = readHeartbeatView(store, NOW);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["old"]).toBeUndefined();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["new"]?.count).toBe(1);
  });

  it("an old-format registry (workspaces only) still reads", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(
      join(store, "stats", "saver-hook-heartbeats.json"),
      JSON.stringify({
        version: 1,
        latest: { ts: iso(NOW), workspaceKey: "aaaa" },
        latestCompression: null,
        workspaces: { aaaa: iso(NOW) },
      }),
    );
    const v = readHeartbeatView(store, NOW);
    expect(v.workspaces).toHaveProperty("aaaa", iso(NOW));
    expect(v.completions).toBeUndefined();
    expect(v.failures).toBeUndefined();
    expect(v.daemonFallbacks).toBeUndefined();
  });

  it("drops malformed failure entries field-by-field", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(
      join(store, "stats", "saver-hook-heartbeats.json"),
      JSON.stringify({
        version: 1,
        workspaces: {},
        failures: {
          good: { count: 3, lastAt: iso(NOW), lastKind: "record" },
          badKind: { count: 1, lastAt: iso(NOW), lastKind: "exploded" },
          badCount: { count: "many", lastAt: iso(NOW), lastKind: "record" },
          badShape: "nope",
        },
      }),
    );
    const v = readHeartbeatView(store, NOW);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["good"]?.count).toBe(3);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["badKind"]).toBeUndefined();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["badCount"]).toBeUndefined();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(v.failures?.["badShape"]).toBeUndefined();
  });
});

describe("stale lock (E25)", () => {
  it("steals a stale lock file instead of skipping forever", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    const lock = join(store, "stats", ".saver-heartbeat.lock");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 10_000);
    utimesSync(lock, old, old);
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).toHaveProperty("aaaa", iso(NOW));
  });

  it("a fresh contended lock still skips (contention semantics kept)", () => {
    mkdirSync(join(store, "stats"), { recursive: true });
    writeFileSync(join(store, "stats", ".saver-heartbeat.lock"), ""); // mtime = now
    recordInvocationHeartbeat(store, "aaaa", iso(NOW), NOW);
    expect(readHeartbeatView(store, NOW).workspaces).not.toHaveProperty("aaaa");
  });
});
