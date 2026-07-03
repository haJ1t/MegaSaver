import { type ReconcileDecision, type ReconcileObs, reconcileTransition } from "./reconcile.js";
import type { ProxyControlState } from "./state.js";
import { readControlState, writeControlState } from "./stores.js";

// Injected so proxy-control stays agent-agnostic (the CLI composition root
// supplies the Claude route adapter). Only the value-guarded surface is needed.
export type RouteAdapter = {
  inspect(expectedUrl: string): "absent" | "exact" | "foreign" | "invalid";
  apply(expectedUrl: string): void;
  removeExpected(expectedUrl: string): void;
};

export type ListenerControl = {
  isAlive(): boolean;
  stop(): void;
  healthCheck(): "matching" | "failed" | "none";
};

export type SupervisorDeps = {
  storeRoot: string;
  route: RouteAdapter;
  listener: ListenerControl;
  ownedUrl: string;
  instanceId: string;
  processStartToken: string;
  bootId: string;
  now: () => number;
};

export function observeReality(deps: SupervisorDeps, control: ProxyControlState): ReconcileObs {
  const route = deps.route.inspect(deps.ownedUrl);
  const health = deps.listener.healthCheck();
  const hasLease = control.routeLease !== null;
  return {
    route,
    health,
    hasLease,
    leasePhase: control.routeLease?.phase ?? null,
    ownerDead: control.transition?.handoffDeadline
      ? Date.parse(control.transition.handoffDeadline) <= deps.now()
      : true,
    generationLive: deps.listener.isAlive() && health === "matching",
    confirmed: control.transition?.kind === "drain_complete",
  };
}

// Translate a pure decision into real side effects + the next persisted control
// state. Route mutations go only through the value-guarded adapter, so a foreign
// value is structurally impossible to touch.
function applyDecision(
  deps: SupervisorDeps,
  control: ProxyControlState,
  decision: ReconcileDecision,
): ProxyControlState {
  let lease = control.routeLease;
  let drain = control.drainingGeneration;
  let transition = control.transition;
  const nowIso = new Date(deps.now()).toISOString();

  for (const action of decision.actions) {
    switch (action) {
      case "apply_route":
        deps.route.apply(deps.ownedUrl);
        break;
      case "remove_route":
        deps.route.removeExpected(deps.ownedUrl); // value-guarded
        break;
      case "verify_route":
        break; // read-back handled by the caller's next observation
      case "install_lease":
        lease = {
          url: deps.ownedUrl,
          instanceId: deps.instanceId,
          phase: "installing",
          installedAt: nowIso,
        };
        break;
      case "promote_lease":
        lease = lease ? { ...lease, phase: "active" } : lease;
        break;
      case "clear_lease":
        lease = null;
        break;
      case "enter_drain":
        drain = {
          instanceId: deps.instanceId,
          processStartToken: deps.processStartToken,
          bootId: deps.bootId,
          url: deps.ownedUrl,
          startedAt: nowIso,
        };
        break;
      case "stop_listener":
        deps.listener.stop();
        drain = null;
        break;
      case "clear_transition":
        transition = null;
        break;
      case "resume_bootstrap":
        break; // bootstrap coordinator (P5) resumes the install; state unchanged here
    }
  }

  return {
    ...control,
    routeLease: lease,
    drainingGeneration: drain,
    transition,
    reconcileBlocked: decision.block
      ? { reason: decision.block, at: nowIso }
      : control.reconcileBlocked,
    lastError: decision.error
      ? { code: decision.error, detail: null, at: nowIso }
      : control.lastError,
    updatedAt: nowIso,
  };
}

export type RecoveryResult = { ready: boolean };

// Startup/recovery: drive the recovery matrix to a fixpoint. A single matrix row
// is one step (e.g. disable removes the route, then a re-observation drains the
// live generation); we re-observe and re-reconcile until the transition clears,
// a decision makes no further progress (a retained block awaiting explicit
// recovery), or a bounded iteration cap is hit. With no transition, do nothing.
const MAX_RECONCILE_STEPS = 8;

export function runStartupRecovery(deps: SupervisorDeps): RecoveryResult {
  let ready = false;
  for (let step = 0; step < MAX_RECONCILE_STEPS; step++) {
    const before = readControlState(deps.storeRoot);
    if (before.transition === null) break;
    const routeBefore = deps.route.inspect(deps.ownedUrl);
    const obs = observeReality(deps, before);
    const decision = reconcileTransition(before.transition, obs, before.desiredEnabled);
    ready = decision.ready;
    const after = applyDecision(deps, before, decision);
    writeControlState(deps.storeRoot, after);
    // A step made progress if the control state OR the observable route changed.
    // No progress ⇒ a retained block awaiting explicit recovery ⇒ stop.
    const routeAfter = deps.route.inspect(deps.ownedUrl);
    const progressed = !sameState(before, after) || routeBefore !== routeAfter;
    if (!progressed) break;
  }
  return { ready };
}

// Equal for fixpoint purposes: the reconcile-relevant fields did not change.
function sameState(a: ProxyControlState, b: ProxyControlState): boolean {
  return (
    JSON.stringify(a.routeLease) === JSON.stringify(b.routeLease) &&
    JSON.stringify(a.drainingGeneration) === JSON.stringify(b.drainingGeneration) &&
    JSON.stringify(a.transition) === JSON.stringify(b.transition)
  );
}

// Fixed 5-second monitor. Suspended while a transition is retained (observe-only:
// never mutates route/lease/block). With no transition, missing/foreign route
// drift blocks + drains the still-healthy generation and never re-applies.
export function monitorTick(deps: SupervisorDeps): void {
  const control = readControlState(deps.storeRoot);
  if (control.transition !== null) return; // observe-only during a retained transition

  // During an expected-unrouted (disable) window there is no transition here by
  // construction; a missing route with no lease is simply the steady disabled
  // state. Drift only matters when we still hold a lease.
  if (control.routeLease === null) return;
  const route = deps.route.inspect(deps.ownedUrl);
  if (route === "exact") return; // still routed, no drift

  const nowIso = new Date(deps.now()).toISOString();
  const healthy = deps.listener.isAlive() && deps.listener.healthCheck() === "matching";
  const next: ProxyControlState = {
    ...control,
    // Never overwrite/remove: a foreign value is preserved; a leased exact value
    // is only cleared as a stale lease (not by touching the route).
    routeLease: null,
    reconcileBlocked: {
      reason: route === "foreign" ? "route_conflict" : "route_removed",
      at: nowIso,
    },
    drainingGeneration: healthy
      ? {
          instanceId: deps.instanceId,
          processStartToken: deps.processStartToken,
          bootId: deps.bootId,
          url: deps.ownedUrl,
          startedAt: nowIso,
        }
      : control.drainingGeneration,
    updatedAt: nowIso,
  };
  writeControlState(deps.storeRoot, next);
}
