import { describe, expect, it } from "vitest";
import { type ReconcileObs, reconcileTransition } from "../src/reconcile.js";
import type { ProxyTransition } from "../src/state.js";

const owner = {
  id: "t1",
  ownerKind: "supervisor" as const,
  ownerInstanceId: "inst",
  ownerProcessStartToken: "tok",
  ownerBootId: "boot",
  ownerFenceToken: "f1",
  handoffDeadline: null,
  startedAt: "2026-07-03T00:00:00.000Z",
};

const enable = (phase: Extract<ProxyTransition, { kind: "enable" }>["phase"]): ProxyTransition => ({
  ...owner,
  kind: "enable",
  phase,
  expectedUnrouted: false,
});
const disable = (
  phase: Extract<ProxyTransition, { kind: "disable" }>["phase"],
): ProxyTransition => ({ ...owner, kind: "disable", phase, expectedUnrouted: true });
const drain = (): ProxyTransition => ({
  ...owner,
  kind: "drain_complete",
  phase: "confirmation_persisted",
  expectedUnrouted: true,
});

const base: ReconcileObs = {
  route: "absent",
  health: "none",
  hasLease: false,
  leasePhase: null,
  ownerDead: false,
  generationLive: false,
  confirmed: false,
};
const obs = (over: Partial<ReconcileObs>): ReconcileObs => ({ ...base, ...over });

describe("enable recovery", () => {
  it("intent_persisted with desired-false dead owner clears the transition", () => {
    const d = reconcileTransition(enable("intent_persisted"), obs({ ownerDead: true }), false);
    expect(d.actions).toContain("clear_transition");
    expect(d.ready).toBe(false);
  });

  it("bootstrap_pending resumes bootstrap and never touches a pre-existing route", () => {
    const d = reconcileTransition(enable("bootstrap_pending"), obs({ route: "foreign" }), true);
    expect(d.actions).toContain("resume_bootstrap");
    expect(d.actions).not.toContain("apply_route");
    expect(d.actions).not.toContain("remove_route");
  });

  it("listener_healthy with matching health installs the lease", () => {
    const d = reconcileTransition(enable("listener_healthy"), obs({ health: "matching" }), true);
    expect(d.actions).toContain("install_lease");
  });

  it("listener_healthy with failed health blocks and stops only the owned listener", () => {
    const d = reconcileTransition(enable("listener_healthy"), obs({ health: "failed" }), true);
    expect(d.actions).toContain("stop_listener");
    expect(d.error).toBe("healthcheck_failed");
    expect(d.ready).toBe(false);
  });

  it("lease_installing + exact + matching promotes to active and reports ready", () => {
    const d = reconcileTransition(
      enable("lease_installing"),
      obs({ route: "exact", health: "matching", hasLease: true, leasePhase: "installing" }),
      true,
    );
    expect(d.actions).toEqual(
      expect.arrayContaining(["verify_route", "promote_lease", "clear_transition"]),
    );
    expect(d.ready).toBe(true);
  });

  it("lease_installing + exact + failed health removes the leased route and blocks", () => {
    const d = reconcileTransition(
      enable("lease_installing"),
      obs({ route: "exact", health: "failed", hasLease: true, leasePhase: "installing" }),
      true,
    );
    expect(d.actions).toContain("remove_route");
    expect(d.actions).toContain("clear_lease");
    expect(d.ready).toBe(false);
  });

  it("lease_installing + absent + matching applies then promotes", () => {
    const d = reconcileTransition(
      enable("lease_installing"),
      obs({ route: "absent", health: "matching", hasLease: true, leasePhase: "installing" }),
      true,
    );
    expect(d.actions).toEqual(
      expect.arrayContaining(["apply_route", "verify_route", "promote_lease"]),
    );
    expect(d.ready).toBe(true);
  });

  it("lease_installing + foreign preserves the foreign value and blocks (never overwrites)", () => {
    const d = reconcileTransition(
      enable("lease_installing"),
      obs({ route: "foreign", hasLease: true, leasePhase: "installing" }),
      true,
    );
    expect(d.actions).not.toContain("apply_route");
    expect(d.actions).not.toContain("remove_route");
    expect(d.block).toBe("route_conflict");
  });

  it("route_verified + exact + matching clears the transition and is ready", () => {
    const d = reconcileTransition(
      enable("route_verified"),
      obs({ route: "exact", health: "matching", hasLease: true, leasePhase: "active" }),
      true,
    );
    expect(d.actions).toContain("clear_transition");
    expect(d.ready).toBe(true);
  });
});

describe("enable rollback", () => {
  it("healthy listener + leased exact route → value-guard remove, drain, clear", () => {
    const d = reconcileTransition(
      enable("rollback"),
      obs({
        route: "exact",
        health: "matching",
        hasLease: true,
        leasePhase: "active",
        generationLive: true,
      }),
      true,
    );
    expect(d.actions).toContain("remove_route");
    expect(d.actions).toContain("enter_drain");
    expect(d.actions).toContain("clear_transition");
  });

  it("exact unleased route → retain transition and block for explicit recovery", () => {
    const d = reconcileTransition(
      enable("rollback"),
      obs({ route: "exact", hasLease: false, generationLive: true }),
      true,
    );
    expect(d.retainTransition).toBe(true);
    expect(d.actions).not.toContain("remove_route"); // unleased exact never removed
  });
});

describe("disable", () => {
  it("unroute_expected + lease + exact → value-guarded remove, never apply", () => {
    const d = reconcileTransition(
      disable("unroute_expected"),
      obs({ route: "exact", hasLease: true, leasePhase: "active" }),
      false,
    );
    expect(d.actions).toContain("remove_route");
    expect(d.actions).not.toContain("apply_route");
  });

  it("unroute_expected + absent + live generation → clear lease and enter drain", () => {
    const d = reconcileTransition(
      disable("unroute_expected"),
      obs({ route: "absent", hasLease: true, generationLive: true }),
      false,
    );
    expect(d.actions).toContain("clear_lease");
    expect(d.actions).toContain("enter_drain");
    expect(d.actions).not.toContain("apply_route");
  });

  it("unroute_expected + absent + no live generation → disabled success, no drain", () => {
    const d = reconcileTransition(
      disable("unroute_expected"),
      obs({ route: "absent", hasLease: true, generationLive: false }),
      false,
    );
    expect(d.actions).toContain("clear_transition");
    expect(d.actions).not.toContain("enter_drain");
  });

  it("unroute_expected + foreign route is preserved (never removed)", () => {
    const d = reconcileTransition(
      disable("unroute_expected"),
      obs({ route: "foreign", hasLease: true, generationLive: true }),
      false,
    );
    expect(d.actions).not.toContain("remove_route");
    expect(d.actions).not.toContain("apply_route");
  });

  it("unroute_expected + exact unleased → conflict, retain transition, keep listener", () => {
    const d = reconcileTransition(
      disable("unroute_expected"),
      obs({ route: "exact", hasLease: false }),
      false,
    );
    expect(d.retainTransition).toBe(true);
    expect(d.actions).not.toContain("stop_listener");
    expect(d.actions).not.toContain("remove_route");
  });
});

describe("drain_complete", () => {
  it("confirmed + live generation + safe route → stop and clear", () => {
    const d = reconcileTransition(
      drain(),
      obs({ route: "absent", generationLive: true, confirmed: true }),
      false,
    );
    expect(d.actions).toContain("stop_listener");
    expect(d.actions).toContain("clear_transition");
  });

  it("dead generation → clear drain, never rebind", () => {
    const d = reconcileTransition(
      drain(),
      obs({ route: "absent", generationLive: false, confirmed: true }),
      false,
    );
    expect(d.actions).toContain("clear_transition");
    expect(d.actions).not.toContain("stop_listener");
  });

  it("confirmed + exact unleased route blocks and preserves the listener", () => {
    const d = reconcileTransition(
      drain(),
      obs({ route: "exact", hasLease: false, generationLive: true, confirmed: true }),
      false,
    );
    expect(d.actions).not.toContain("stop_listener");
    expect(d.retainTransition).toBe(true);
  });

  it("confirmed + leased-exact route → value-guard remove FIRST, retain, don't strand the route", () => {
    // Reachable when `stop --confirm-clients-restarted` is issued directly on a
    // still-routed+leased state. Must remove the owned route before stopping so
    // the listener never dies while the route still points at it.
    const d = reconcileTransition(
      drain(),
      obs({
        route: "exact",
        hasLease: true,
        leasePhase: "active",
        generationLive: true,
        confirmed: true,
      }),
      false,
    );
    expect(d.actions).toContain("remove_route");
    expect(d.actions).toContain("verify_route");
    expect(d.actions).not.toContain("stop_listener"); // listener stays up until the route is gone
    expect(d.retainTransition).toBe(true);
  });

  it("confirmed + live generation + absent route → clears lease, stops, and clears", () => {
    const d = reconcileTransition(
      drain(),
      obs({ route: "absent", hasLease: true, generationLive: true, confirmed: true }),
      false,
    );
    expect(d.actions).toContain("clear_lease"); // lease cleared so uninstall unblocks
    expect(d.actions).toContain("stop_listener");
    expect(d.actions).toContain("clear_transition");
  });
});

describe("global invariants across every enumerated row", () => {
  const routes: ReconcileObs["route"][] = ["absent", "exact", "foreign", "invalid"];
  const healths: ReconcileObs["health"][] = ["matching", "failed", "none"];
  const phases: ProxyTransition[] = [
    enable("intent_persisted"),
    enable("bootstrap_pending"),
    enable("listener_healthy"),
    enable("lease_installing"),
    enable("route_verified"),
    enable("rollback"),
    disable("unroute_expected"),
    disable("rollback"),
    drain(),
  ];

  it("never removes a foreign route, and never applies a route in a disable/drain transition", () => {
    for (const t of phases) {
      for (const route of routes) {
        for (const health of healths) {
          for (const hasLease of [true, false]) {
            for (const generationLive of [true, false]) {
              const d = reconcileTransition(
                t,
                obs({
                  route,
                  health,
                  hasLease,
                  leasePhase: hasLease ? "active" : null,
                  generationLive,
                  confirmed: true,
                }),
                t.kind === "enable",
              );
              if (route === "foreign") expect(d.actions).not.toContain("remove_route");
              if (t.expectedUnrouted) expect(d.actions).not.toContain("apply_route");
              // A route is only ever removed when we hold a lease AND the current value is our exact url.
              if (d.actions.includes("remove_route")) {
                expect(hasLease && route === "exact").toBe(true);
              }
            }
          }
        }
      }
    }
  });
});
