import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProxyControlState, ProxyTransition } from "../src/state.js";
import { readControlState, writeControlState } from "../src/stores.js";
import type { RouteAdapter } from "../src/supervisor.js";
import {
  monitorTick,
  observeReality,
  runStartupRecovery,
  superviseDrive,
} from "../src/supervisor.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-sup-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const OWNED = "http://127.0.0.1:8787";

// A fake route backed by a mutable value; foreign values must survive.
function fakeRoute(initial: string | null): RouteAdapter & { value: string | null } {
  const state = { value: initial };
  return {
    get value() {
      return state.value;
    },
    inspect(expected) {
      if (state.value === null) return "absent";
      return state.value === expected ? "exact" : "foreign";
    },
    apply(expected) {
      state.value = expected;
    },
    removeExpected(expected) {
      if (state.value === expected) state.value = null;
    },
  };
}

// A route whose apply()/removeExpected() SILENTLY do nothing — models a lost
// write. inspect() keeps reporting the pre-mutation value so verify_route can
// catch the discrepancy.
function brokenRoute(initial: string | null): RouteAdapter & { value: string | null } {
  const state = { value: initial };
  return {
    get value() {
      return state.value;
    },
    inspect(expected) {
      if (state.value === null) return "absent";
      return state.value === expected ? "exact" : "foreign";
    },
    apply() {
      /* write silently fails */
    },
    removeExpected() {
      /* removal silently fails */
    },
  };
}

function fakeListener(alive: boolean, health: "matching" | "failed" | "none") {
  const s = { alive };
  return {
    isAlive: () => s.alive,
    stop: () => {
      s.alive = false;
    },
    healthCheck: () => health,
  };
}

const owner = {
  id: "t1",
  ownerInstanceId: "inst",
  ownerProcessStartToken: "tok",
  ownerBootId: "boot",
  ownerFenceToken: "f1",
  handoffDeadline: null,
  startedAt: "2026-07-03T00:00:00.000Z",
};
const enableT = (
  phase: Extract<ProxyTransition, { kind: "enable" }>["phase"],
): ProxyTransition => ({
  ...owner,
  ownerKind: "supervisor",
  kind: "enable",
  phase,
  expectedUnrouted: false,
});
const disableT = (): ProxyTransition => ({
  ...owner,
  ownerKind: "supervisor",
  kind: "disable",
  phase: "unroute_expected",
  expectedUnrouted: true,
});
const drainCompleteT = (): ProxyTransition => ({
  ...owner,
  ownerKind: "supervisor",
  kind: "drain_complete",
  phase: "confirmation_persisted",
  expectedUnrouted: true,
});

function control(over: Partial<ProxyControlState>): ProxyControlState {
  return {
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
    ...over,
  };
}

const deps = (route: RouteAdapter, listener: ReturnType<typeof fakeListener>) => ({
  storeRoot: store,
  route,
  listener,
  ownedUrl: OWNED,
  instanceId: "inst",
  processStartToken: "tok",
  bootId: "boot",
  now: () => Date.UTC(2026, 6, 3, 0, 0, 30),
});

describe("observeReality", () => {
  it("reports exact route + matching health as a live generation", () => {
    const o = observeReality(
      deps(fakeRoute(OWNED), fakeListener(true, "matching")),
      control({
        routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
      }),
    );
    expect(o.route).toBe("exact");
    expect(o.health).toBe("matching");
    expect(o.generationLive).toBe(true);
    expect(o.hasLease).toBe(true);
  });
});

describe("runStartupRecovery — applies the matrix to real state", () => {
  it("enable/lease_installing + exact + matching → promotes lease, clears transition, ready", () => {
    const route = fakeRoute(OWNED);
    writeControlState(
      store,
      control({
        transition: enableT("lease_installing"),
        routeLease: { url: OWNED, instanceId: "inst", phase: "installing", installedAt: "x" },
      }),
    );
    const r = runStartupRecovery(deps(route, fakeListener(true, "matching")));
    expect(r.ready).toBe(true);
    const s = readControlState(store);
    expect(s.transition).toBeNull();
    expect(s.routeLease?.phase).toBe("active");
    expect(route.value).toBe(OWNED);
  });

  it("enable/lease_installing + foreign route → preserves foreign, clears lease, blocks", () => {
    const route = fakeRoute("http://127.0.0.1:9999"); // foreign
    writeControlState(
      store,
      control({
        transition: enableT("lease_installing"),
        routeLease: { url: OWNED, instanceId: "inst", phase: "installing", installedAt: "x" },
      }),
    );
    runStartupRecovery(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(route.value).toBe("http://127.0.0.1:9999"); // never overwritten
    expect(s.routeLease).toBeNull();
    expect(s.reconcileBlocked?.reason).toBe("route_conflict");
  });

  it("disable/unroute_expected + exact leased → removes route, then drains a live generation", () => {
    const route = fakeRoute(OWNED);
    writeControlState(
      store,
      control({
        desiredEnabled: false,
        transition: disableT(),
        routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
      }),
    );
    runStartupRecovery(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(route.value).toBeNull(); // owned route removed
    expect(s.routeLease).toBeNull();
    expect(s.drainingGeneration).not.toBeNull(); // live generation entered drain
  });

  it("no transition → returns without mutating the route", () => {
    const route = fakeRoute("http://127.0.0.1:9999");
    writeControlState(store, control({ transition: null }));
    runStartupRecovery(deps(route, fakeListener(true, "matching")));
    expect(route.value).toBe("http://127.0.0.1:9999");
  });
});

describe("superviseDrive — the live supervisor drives enable to a routed fixpoint", () => {
  it("intent_persisted + healthy listener + absent route → applies route, active lease, cleared", () => {
    const route = fakeRoute(null);
    writeControlState(store, control({ transition: enableT("intent_persisted") }));
    const r = superviseDrive(deps(route, fakeListener(true, "matching")));
    expect(r.ready).toBe(true);
    const s = readControlState(store);
    expect(route.value).toBe(OWNED); // route actually applied — the whole point
    expect(s.transition).toBeNull();
    expect(s.routeLease?.phase).toBe("active");
  });

  it("intent_persisted but listener not yet healthy → does NOT route or advance", () => {
    const route = fakeRoute(null);
    writeControlState(store, control({ transition: enableT("intent_persisted") }));
    superviseDrive(deps(route, fakeListener(true, "none")));
    const s = readControlState(store);
    expect(route.value).toBeNull(); // never routed on an unverified listener
    expect(s.transition?.kind).toBe("enable");
  });

  it("foreign route present at enable → never overwrites it, blocks route_conflict", () => {
    const route = fakeRoute("http://127.0.0.1:9999");
    writeControlState(store, control({ transition: enableT("intent_persisted") }));
    superviseDrive(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(route.value).toBe("http://127.0.0.1:9999"); // foreign preserved
    expect(s.reconcileBlocked?.reason).toBe("route_conflict");
  });
});

describe("superviseDrive — disable drain terminates on drain_complete", () => {
  it("drain_complete + live generation → stops the key-holding listener, clears transition + drain", () => {
    const route = fakeRoute(null); // route already removed during the disable phase
    const listener = fakeListener(true, "matching");
    writeControlState(
      store,
      control({
        desiredEnabled: false,
        transition: drainCompleteT(),
        drainingGeneration: {
          instanceId: "inst",
          processStartToken: "tok",
          bootId: "boot",
          url: OWNED,
          startedAt: "x",
        },
      }),
    );
    superviseDrive(deps(route, listener));
    const s = readControlState(store);
    expect(s.transition).toBeNull(); // terminal idle — NOT a permanent drain
    expect(s.drainingGeneration).toBeNull();
    expect(listener.isAlive()).toBe(false); // listener holding the API key is stopped
  });
});

describe("applyDecision — stale block/error cleared on a clean terminal reconcile", () => {
  it("a clean enable resets a pre-existing reconcileBlocked + lastError", () => {
    const route = fakeRoute(null);
    writeControlState(
      store,
      control({
        transition: enableT("lease_installing"),
        routeLease: { url: OWNED, instanceId: "inst", phase: "installing", installedAt: "x" },
        reconcileBlocked: { reason: "route_conflict", at: "x" },
        lastError: { code: "healthcheck_failed", detail: null, at: "x" },
      }),
    );
    runStartupRecovery(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(s.transition).toBeNull();
    expect(s.reconcileBlocked).toBeNull(); // no longer reports a stale conflict
    expect(s.lastError).toBeNull();
  });
});

describe("verify_route read-back — a lost write is caught, not reported as done", () => {
  it("apply that does not stick → transition retained, lease not promoted, blocked", () => {
    const route = brokenRoute(null); // apply() is a no-op → stays absent
    writeControlState(
      store,
      control({
        transition: enableT("lease_installing"),
        routeLease: { url: OWNED, instanceId: "inst", phase: "installing", installedAt: "x" },
      }),
    );
    const r = runStartupRecovery(deps(route, fakeListener(true, "matching")));
    expect(r.ready).toBe(false); // NOT ready — verify failed
    const s = readControlState(store);
    expect(s.transition).not.toBeNull(); // retained for retry, not cleared
    expect(s.routeLease?.phase).toBe("installing"); // never promoted to active
    expect(s.reconcileBlocked?.reason).toBe("route_removed");
  });
});

describe("monitorTick — observe-only while a transition is retained", () => {
  it("does NOT mutate route or state when a transition is present", () => {
    const route = fakeRoute(OWNED);
    const c = control({ transition: enableT("rollback") });
    writeControlState(store, c);
    monitorTick(deps(route, fakeListener(true, "matching")));
    expect(route.value).toBe(OWNED);
    expect(readControlState(store).transition).not.toBeNull();
  });

  it("with no transition + enabled + healthy + route drift → blocks and drains, never applies", () => {
    const route = fakeRoute(null); // drifted away
    writeControlState(
      store,
      control({
        transition: null,
        routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
      }),
    );
    monitorTick(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(route.value).toBeNull(); // never re-applied
    expect(s.reconcileBlocked?.reason).toBe("route_removed");
    expect(s.routeLease).toBeNull();
    expect(s.drainingGeneration).not.toBeNull();
  });

  it("no transition + foreign route drift → preserves foreign, blocks route_conflict", () => {
    const route = fakeRoute("http://127.0.0.1:9999");
    writeControlState(
      store,
      control({
        transition: null,
        routeLease: { url: OWNED, instanceId: "inst", phase: "active", installedAt: "x" },
      }),
    );
    monitorTick(deps(route, fakeListener(true, "matching")));
    const s = readControlState(store);
    expect(route.value).toBe("http://127.0.0.1:9999");
    expect(s.reconcileBlocked?.reason).toBe("route_conflict");
  });
});
