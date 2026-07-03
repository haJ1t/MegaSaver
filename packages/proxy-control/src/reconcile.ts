import type { ProxyControlErrorCode, ProxyTransition } from "./state.js";

// Abstract actions the supervisor must perform for a decision. Kept side-effect
// free here so every recovery-matrix row is a pure input → decision mapping that
// tests can exhaustively exercise (spec §Transition recovery matrix).
export type ReconcileAction =
  | "resume_bootstrap"
  | "install_lease"
  | "apply_route"
  | "verify_route"
  | "promote_lease"
  | "clear_lease"
  | "remove_route" // value-guarded: only ever a leased exact owned url
  | "enter_drain"
  | "stop_listener"
  | "clear_transition";

export type ReconcileObs = {
  // Inspection of the Claude route relative to OUR owned url.
  route: "absent" | "exact" | "foreign" | "invalid";
  // Ownership health of the current listener generation.
  health: "matching" | "failed" | "none";
  hasLease: boolean;
  leasePhase: "installing" | "active" | null;
  ownerDead: boolean;
  // A verifiably live, authenticated, same-instance generation exists.
  generationLive: boolean;
  // drain_complete: the operator confirmed clients were closed/restarted.
  confirmed: boolean;
};

export type ReconcileDecision = {
  actions: ReconcileAction[];
  block: "route_removed" | "route_conflict" | null;
  error: ProxyControlErrorCode | null;
  retainTransition: boolean;
  ready: boolean;
};

function decide(over: Partial<ReconcileDecision>): ReconcileDecision {
  return {
    actions: [],
    block: null,
    error: null,
    retainTransition: false,
    ready: false,
    ...over,
  };
}

// A leased exact owned url is the ONLY thing we ever remove (value-guard).
const leasedExact = (o: ReconcileObs): boolean => o.hasLease && o.route === "exact";

export function reconcileTransition(
  t: ProxyTransition,
  o: ReconcileObs,
  desiredEnabled: boolean,
): ReconcileDecision {
  if (t.kind === "enable") return reconcileEnable(t, o, desiredEnabled);
  if (t.kind === "disable") return reconcileDisable(t, o);
  return reconcileDrain(o);
}

function reconcileEnable(
  t: Extract<ProxyTransition, { kind: "enable" }>,
  o: ReconcileObs,
  desiredEnabled: boolean,
): ReconcileDecision {
  switch (t.phase) {
    case "intent_persisted":
      // The durable opt-in was only persisted at step 2 → desiredEnabled true.
      // If a dead owner left it at intent_persisted with desired still false, the
      // opt-in never landed: clear it and preserve disabled intent.
      if (!desiredEnabled) return decide({ actions: ["clear_transition"] });
      return decide({ actions: ["resume_bootstrap"], retainTransition: true });
    case "bootstrap_pending":
      // No authenticated supervisor yet — resume bootstrap. No lease exists; a
      // pre-existing route (even foreign) is preserved until the adoption check.
      return decide({ actions: ["resume_bootstrap"], retainTransition: true });
    case "listener_healthy":
      if (o.health === "matching")
        return decide({ actions: ["install_lease"], retainTransition: true });
      // Failed health: block, stop only the owned listener.
      return decide({
        actions: ["stop_listener"],
        error: "healthcheck_failed",
        retainTransition: true,
      });
    case "lease_installing":
      if (o.route === "foreign")
        return decide({
          actions: ["clear_lease"],
          block: "route_conflict",
          error: "route_conflict",
        });
      if (o.route === "exact") {
        if (o.health === "matching")
          return decide({
            actions: ["verify_route", "promote_lease", "clear_transition"],
            ready: true,
          });
        // exact + failed/none health → remove leased exact route, block.
        return decide({
          actions: [...(leasedExact(o) ? (["remove_route"] as const) : []), "clear_lease"],
          block: "route_removed",
          error: "healthcheck_failed",
        });
      }
      if (o.route === "absent") {
        if (o.health === "matching")
          return decide({
            actions: ["apply_route", "verify_route", "promote_lease", "clear_transition"],
            ready: true,
          });
        return decide({
          actions: ["clear_lease"],
          block: "route_removed",
          error: "healthcheck_failed",
        });
      }
      // invalid inspection → unknown ownership; retain + block for recovery.
      return decide({ error: "settings_invalid", retainTransition: true });
    case "route_verified":
      if (o.route === "exact" && o.health === "matching")
        return decide({ actions: ["clear_transition"], ready: true });
      // Any mismatch degrades into a leased rollback.
      return reconcileEnableRollback(o);
    case "rollback":
      return reconcileEnableRollback(o);
  }
}

function reconcileEnableRollback(o: ReconcileObs): ReconcileDecision {
  // A live authenticated generation is health-verified by definition; its
  // absence is the "ownership health failed or listener closed" residual row.
  const listenerHealthy = o.generationLive;
  if (!listenerHealthy) {
    // Health failed or listener closed: value-guard remove only a leased exact
    // route, clear this attempt's lease/transition, report the forced residual.
    return decide({
      actions: [
        ...(leasedExact(o) ? (["remove_route"] as const) : []),
        "clear_lease",
        "clear_transition",
      ],
      error: "runtime_failed",
    });
  }
  if (o.route === "exact" && o.hasLease)
    return decide({
      actions: ["remove_route", "verify_route", "enter_drain", "clear_transition"],
      error: "runtime_failed",
    });
  if (o.route === "absent" || o.route === "foreign")
    return decide({
      actions: ["clear_lease", "enter_drain", "clear_transition"],
      error: "runtime_failed",
    });
  // exact unleased or invalid: preserve, retain, block for explicit recovery.
  return decide({ retainTransition: true, error: "route_conflict" });
}

function reconcileDisable(
  t: Extract<ProxyTransition, { kind: "disable" }>,
  o: ReconcileObs,
): ReconcileDecision {
  // rollback delegates to the same route-observation handling; a still-owned
  // route is kept-alive for explicit stop/recover.
  if (t.phase === "rollback" && o.route === "exact" && o.hasLease)
    return decide({ retainTransition: true, error: "disable_failed" });

  if (o.route === "invalid") return decide({ retainTransition: true, error: "settings_invalid" });
  if (o.route === "exact" && o.hasLease)
    // Resume value-guarded removal + verification. Never apply.
    return decide({ actions: ["remove_route", "verify_route"], retainTransition: true });
  if (o.route === "exact" && !o.hasLease)
    // Exact unleased: a conflict — cannot remove or stop; require explicit recovery.
    return decide({ retainTransition: true, error: "route_conflict" });
  // absent or foreign (foreign preserved): safe to proceed.
  if (o.generationLive) return decide({ actions: ["clear_lease", "enter_drain"] });
  return decide({ actions: ["clear_lease", "clear_transition"] });
}

function reconcileDrain(o: ReconcileObs): ReconcileDecision {
  if (o.route === "exact" && !o.hasLease)
    return decide({ retainTransition: true, error: "route_conflict" });
  if (o.route === "invalid") return decide({ retainTransition: true, error: "settings_invalid" });
  if (!o.confirmed) return decide({ retainTransition: true });
  // A drain_complete can be issued directly on a still-owned, still-routed state
  // (not only after a plain disable). Remove our leased-exact route FIRST — value-
  // guarded — and re-observe, so we never stop the listener while the route still
  // points at it (which would strand a dead route + a live lease that blocks
  // uninstall). Only once the owned route is gone do we stop + clear.
  if (leasedExact(o))
    return decide({ actions: ["remove_route", "verify_route"], retainTransition: true });
  // Owned route gone (absent/foreign-preserved): clear our lease, stop the live
  // generation if any, and finish. clear_lease is a no-op when a prior disable
  // already cleared it.
  if (o.generationLive)
    return decide({ actions: ["clear_lease", "stop_listener", "clear_transition"] });
  // Dead generation / prior boot: clear lease + drain, never rebind.
  return decide({ actions: ["clear_lease", "clear_transition"] });
}
