import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ProxyControlState,
  type ProxyRuntimeState,
  proxyControlStateSchema,
  upstreamBaseUrlSchema,
} from "../src/state.js";
import {
  DISABLED_CONTROL_STATE,
  readControlState,
  readRuntimeState,
  writeControlState,
  writeRuntimeState,
} from "../src/stores.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-proxyctl-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const CONTROL: ProxyControlState = {
  version: 1,
  desiredEnabled: true,
  port: 8787,
  upstreamBaseUrl: "https://api.anthropic.com",
  routeLease: null,
  drainingGeneration: null,
  reconcileBlocked: null,
  transition: null,
  updatedAt: "2026-07-03T00:00:00.000Z",
  lastError: null,
};

const RUNTIME: ProxyRuntimeState = {
  version: 1,
  pid: 1234,
  processStartToken: "start-tok",
  bootId: "boot-1",
  instanceId: "inst-1",
  controlUrl: "http://127.0.0.1:5555",
  controlToken: "ctl-tok",
  healthCapability: "cap",
  proxyUrl: "http://127.0.0.1:8787",
  startedAt: "2026-07-03T00:00:00.000Z",
  lastReconciledAt: "2026-07-03T00:00:00.000Z",
  lastUsagePersistedAt: null,
};

describe("upstreamBaseUrlSchema", () => {
  it("accepts an HTTPS origin and an explicit loopback HTTP origin", () => {
    expect(upstreamBaseUrlSchema.safeParse("https://api.anthropic.com").success).toBe(true);
    expect(upstreamBaseUrlSchema.safeParse("http://127.0.0.1:9999").success).toBe(true);
  });
  it("rejects userinfo/path/query/fragment and non-loopback plaintext", () => {
    expect(upstreamBaseUrlSchema.safeParse("https://u:p@api.anthropic.com").success).toBe(false);
    expect(upstreamBaseUrlSchema.safeParse("https://api.anthropic.com/v1").success).toBe(false);
    expect(upstreamBaseUrlSchema.safeParse("https://api.anthropic.com?x=1").success).toBe(false);
    expect(upstreamBaseUrlSchema.safeParse("http://evil.com").success).toBe(false);
  });
});

describe("control state store", () => {
  it("round-trips a valid control state", () => {
    writeControlState(store, CONTROL);
    expect(readControlState(store)).toEqual(CONTROL);
  });

  it("missing control state reads as disabled", () => {
    expect(readControlState(store)).toEqual(DISABLED_CONTROL_STATE);
  });

  it("invalid/corrupt control state reads as disabled", () => {
    const dir = join(store, "proxy");
    writeControlState(store, CONTROL); // creates dir
    writeFileSync(join(dir, "control.json"), "{corrupt");
    expect(readControlState(store)).toEqual(DISABLED_CONTROL_STATE);
  });

  it("rejects a state that fails schema (e.g. bad upstream)", () => {
    expect(
      proxyControlStateSchema.safeParse({ ...CONTROL, upstreamBaseUrl: "http://evil" }).success,
    ).toBe(false);
  });

  it("writes files 0600 under a 0700 proxy dir", () => {
    if (process.platform === "win32") return;
    writeControlState(store, CONTROL);
    expect(statSync(join(store, "proxy", "control.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(store, "proxy")).mode & 0o777).toBe(0o700);
  });

  it("refuses a symlinked control file (reads disabled)", () => {
    if (process.platform === "win32") return;
    writeControlState(store, CONTROL);
    const p = join(store, "proxy", "control.json");
    rmSync(p);
    writeFileSync(join(store, "elsewhere.json"), JSON.stringify(CONTROL));
    symlinkSync(join(store, "elsewhere.json"), p);
    expect(readControlState(store)).toEqual(DISABLED_CONTROL_STATE);
  });
});

describe("runtime state store", () => {
  it("round-trips runtime state", () => {
    writeRuntimeState(store, RUNTIME);
    expect(readRuntimeState(store)).toEqual(RUNTIME);
  });
  it("missing runtime state reads null", () => {
    expect(readRuntimeState(store)).toBeNull();
  });
});
