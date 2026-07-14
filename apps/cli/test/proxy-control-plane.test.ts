import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordCompressionHeartbeat, recordInvocationHeartbeat } from "@megasaver/context-gate";
import type { LaunchctlRunner, SupervisorDeps } from "@megasaver/proxy-control";
import { readControlState, superviseDrive, writeControlState } from "@megasaver/proxy-control";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ProxyControlPlaneDeps,
  runProxyServiceUninstall,
  runProxyStart,
  runProxyStatus,
  runProxyStop,
} from "../src/commands/proxy/control.js";

let store: string;
let laDir: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-cli-proxy-"));
  laDir = mkdtempSync(join(tmpdir(), "mega-cli-la-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(laDir, { recursive: true, force: true });
});

const OWNED = "http://127.0.0.1:8787";
// Static (not built from `store`, which is only set in beforeEach).
const MANAGED_ARGV = ["/bin/mega", "proxy", "supervise", "--store", "/store"];

function fakeRoute(initial: string | null) {
  const s = { value: initial };
  return {
    get value() {
      return s.value;
    },
    inspect: (u: string) =>
      (s.value === null ? "absent" : s.value === u ? "exact" : "foreign") as
        | "absent"
        | "exact"
        | "foreign"
        | "invalid",
    apply: (u: string) => {
      if (s.value === u) return false;
      s.value = u;
      return true;
    },
    removeExpected: (u: string) => {
      if (s.value === u) s.value = null;
    },
    ensureHooks: () => ({ configured: true as const }),
    inspectHooks: () => true,
  };
}

function fakeLaunchctl(loaded: Record<string, string[] | undefined> = {}): LaunchctlRunner & {
  calls: string[];
} {
  const state = { ...loaded };
  const calls: string[] = [];
  return {
    calls,
    print: (l) => (state[l] ? { loaded: true, programArguments: state[l] as string[] } : null),
    bootout: (l) => {
      calls.push(`bootout ${l}`);
      state[l] = undefined;
    },
    bootstrap: () => {
      calls.push("bootstrap");
      state["com.megasaver.proxy"] = MANAGED_ARGV;
    },
    kickstart: () => calls.push("kickstart"),
  };
}

const deps = (
  route: ReturnType<typeof fakeRoute>,
  launchctl: ReturnType<typeof fakeLaunchctl>,
): ProxyControlPlaneDeps => ({
  storeRoot: store,
  route,
  launchctl,
  plistPath: join(laDir, "com.megasaver.proxy.plist"),
  backupDir: join(laDir, "backups"),
  superviseArgv: MANAGED_ARGV,
  ownedUrl: OWNED,
  now: () => Date.UTC(2026, 6, 3),
});

describe("runProxyStart", () => {
  it("persists desiredEnabled and installs the managed service", () => {
    const r = runProxyStart(deps(fakeRoute(null), fakeLaunchctl()));
    expect(r.status).toBe("installed");
    expect(readControlState(store).desiredEnabled).toBe(true);
  });

  it("refuses when a legacy service is loaded (never boots it out)", () => {
    const lc = fakeLaunchctl({ "com.megasaver.proxy": ["/bin/mega", "proxy", "start"] });
    const r = runProxyStart(deps(fakeRoute(null), lc));
    expect(r.status).toBe("legacy_service_present");
    expect(lc.calls).not.toContain("bootout com.megasaver.proxy");
  });
});

describe("runProxyStop", () => {
  it("persists a disable transition with desiredEnabled false", () => {
    writeControlState(store, { ...readControlState(store), desiredEnabled: true });
    runProxyStop(deps(fakeRoute(OWNED), fakeLaunchctl()));
    const s = readControlState(store);
    expect(s.desiredEnabled).toBe(false);
    expect(s.transition?.kind).toBe("disable");
  });

  it("--confirm-clients-restarted persists a drain_complete transition", () => {
    writeControlState(store, { ...readControlState(store), desiredEnabled: false });
    runProxyStop(deps(fakeRoute(null), fakeLaunchctl()), { confirmClientsRestarted: true });
    expect(readControlState(store).transition?.kind).toBe("drain_complete");
  });

  it("full stop → drain → confirm → drain_complete lifecycle reaches idle and unblocks uninstall", () => {
    // The blind spot the tracer flagged: prove the disable drain actually
    // terminates instead of parking forever.
    const route = fakeRoute(OWNED);
    const sup = (alive: { v: boolean }): SupervisorDeps => ({
      storeRoot: store,
      route,
      listener: {
        isAlive: () => alive.v,
        stop: () => {
          alive.v = false;
        },
        healthCheck: () => (alive.v ? "matching" : "none"),
      },
      ownedUrl: OWNED,
      instanceId: "inst",
      processStartToken: "tok",
      bootId: "boot",
      now: () => Date.UTC(2026, 6, 3),
    });
    const alive = { v: true };
    // Steady routed state.
    writeControlState(store, {
      ...readControlState(store),
      desiredEnabled: true,
      routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
    });

    // 1) plain stop → disable transition; supervisor drives it into drain.
    runProxyStop(deps(route, fakeLaunchctl()));
    superviseDrive(sup(alive));
    expect(route.value).toBeNull(); // route removed
    expect(readControlState(store).transition).not.toBeNull(); // parked in drain
    expect(runProxyServiceUninstall(deps(route, fakeLaunchctl())).status).toBe("blocked");

    // 2) confirm clients restarted → drain_complete; supervisor stops + clears.
    runProxyStop(deps(route, fakeLaunchctl()), { confirmClientsRestarted: true });
    superviseDrive(sup(alive));
    const s = readControlState(store);
    expect(s.transition).toBeNull(); // terminal idle
    expect(alive.v).toBe(false); // key-holding listener stopped
    expect(runProxyServiceUninstall(deps(route, fakeLaunchctl())).status).toBe("uninstalled");
  });
});

describe("runProxyStatus", () => {
  it("reports the separated control-plane facts", () => {
    writeControlState(store, {
      ...readControlState(store),
      desiredEnabled: true,
      routeLease: { url: OWNED, instanceId: "i", phase: "active", installedAt: "x" },
    });
    const st = runProxyStatus(deps(fakeRoute(OWNED), fakeLaunchctl()));
    expect(st.enabled).toBe(true);
    expect(st.routed).toBe(true);
    expect(st.routeConflict).toBe(false);
    expect(st.desktopSupport).toBe("unverified");
    // saver fields degrade to null until the saver telemetry reader is wired.
    expect(st.lastCompressionAt).toBeNull();
  });

  it("flags a foreign route as routeConflict, not routed", () => {
    writeControlState(store, { ...readControlState(store), desiredEnabled: true });
    const st = runProxyStatus(deps(fakeRoute("http://127.0.0.1:9999"), fakeLaunchctl()));
    expect(st.routed).toBe(false);
    expect(st.routeConflict).toBe(true);
  });

  it("fills saver liveness from the heartbeat registry (cross-spec contract)", () => {
    const now = Date.UTC(2026, 6, 3);
    recordInvocationHeartbeat(store, "wk1", new Date(now - 1000).toISOString(), now);
    recordCompressionHeartbeat(store, "wk1", new Date(now - 2000).toISOString(), now);
    const st = runProxyStatus(deps(fakeRoute(OWNED), fakeLaunchctl()));
    expect(st.lastSaverHookInvocationAt).toBe(new Date(now - 1000).toISOString());
    expect(st.lastCompressionAt).toBe(new Date(now - 2000).toISOString());
    expect(st.lastCompressionAgeMs).toBe(2000);
  });
});

describe("runProxyServiceUninstall", () => {
  it("refuses while still enabled/leased", () => {
    writeControlState(store, {
      ...readControlState(store),
      desiredEnabled: true,
      routeLease: { url: OWNED, instanceId: "i", phase: "active", installedAt: "x" },
    });
    const r = runProxyServiceUninstall(deps(fakeRoute(null), fakeLaunchctl()));
    expect(r.status).toBe("blocked");
  });

  it("uninstalls a dormant managed service when disabled and idle", () => {
    // disabled + no lease/transition
    const lc = fakeLaunchctl({ "com.megasaver.proxy": MANAGED_ARGV });
    const r = runProxyServiceUninstall(deps(fakeRoute(null), lc));
    expect(r.status).toBe("uninstalled");
    expect(lc.calls).toContain("bootout com.megasaver.proxy");
  });
});
