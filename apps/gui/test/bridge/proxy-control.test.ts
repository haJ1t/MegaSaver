import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchctlRunner } from "@megasaver/proxy-control";
import { readControlState, writeControlState } from "@megasaver/proxy-control";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ProxyGuiDeps,
  defaultProxyGuiDeps,
  proxyStatus,
  startProxy,
  stopProxy,
} from "../../bridge/proxy-control.js";

// Persistent-model GUI bridge: persists desired state, never owns a listener or
// clears the route. Injected deps keep the test off real launchd and ~/.claude.
let store: string;
let laDir: string;
let settings: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "gui-proxy-"));
  laDir = mkdtempSync(join(tmpdir(), "gui-proxy-la-"));
  settings = join(mkdtempSync(join(tmpdir(), "gui-proxy-settings-")), "settings.json");
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(laDir, { recursive: true, force: true });
});

function fakeLaunchctl(): LaunchctlRunner {
  const state: Record<string, string[] | undefined> = {};
  return {
    print: (l) => (state[l] ? { loaded: true, programArguments: state[l] as string[] } : null),
    bootout: (l) => {
      state[l] = undefined;
    },
    bootstrap: () => {
      state["com.megasaver.proxy"] = ["/bin/mega", "proxy", "supervise"];
    },
    kickstart: () => {},
  };
}

const deps = (): ProxyGuiDeps => ({
  launchctl: fakeLaunchctl(),
  plistPath: join(laDir, "com.megasaver.proxy.plist"),
  backupDir: join(laDir, "backups"),
  superviseArgv: ["/bin/mega", "proxy", "supervise", "--store", store],
  settingsPath: settings,
});

describe("GUI proxy toggle (persistent model)", () => {
  it("start persists desiredEnabled without owning a listener", () => {
    const st = startProxy(store, deps());
    expect(st.enabled).toBe(true);
    expect(readControlState(store).desiredEnabled).toBe(true);
  });

  it("stop persists a disable transition", () => {
    const d = deps();
    startProxy(store, d);
    const st = stopProxy(store, d);
    expect(st.enabled).toBe(false);
    expect(readControlState(store).transition?.kind).toBe("disable");
  });

  it("status flags a foreign route as routeConflict (never overwritten)", () => {
    const d = deps();
    startProxy(store, d);
    writeFileSync(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9999" } }),
    );
    const st = proxyStatus(store, d);
    expect(st.enabled).toBe(true);
    expect(st.routed).toBe(false);
    expect(st.routeConflict).toBe(true);
  });

  it("status reports draining:true when a draining generation is set", () => {
    const d = deps();
    writeControlState(store, {
      ...readControlState(store),
      desiredEnabled: false,
      drainingGeneration: {
        instanceId: "old",
        processStartToken: "tok",
        bootId: "boot",
        url: "http://127.0.0.1:8787",
        startedAt: "2026-07-05T00:00:00.000Z",
      },
    });
    expect(proxyStatus(store, d).draining).toBe(true);
  });

  it("status reports draining:false when no draining generation is set", () => {
    const d = deps();
    writeControlState(store, {
      ...readControlState(store),
      desiredEnabled: false,
      drainingGeneration: null,
    });
    expect(proxyStatus(store, d).draining).toBe(false);
  });

  it("resolves superviseArgv from the running script path (process.argv[1]), not a literal", () => {
    const argv = defaultProxyGuiDeps(store).superviseArgv;
    expect(argv[0]).toBe(process.execPath);
    expect(argv[1]).toBe(process.argv[1]);
    expect(argv.slice(2)).toEqual(["proxy", "supervise", "--store", store]);
  });
});
