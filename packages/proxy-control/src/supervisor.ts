import { type ReconcileDecision, type ReconcileObs, reconcileTransition } from "./reconcile.js";
import type { ProxyControlErrorCode, ProxyControlState } from "./state.js";
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

  // verify_route is a real read-back gate, not a no-op: it re-inspects the route
  // and, if the preceding apply/remove did NOT take (a lost write or a foreign
  // value slipping in), aborts the rest of the action list so promote_lease /
  // clear_transition never run on an unconfirmed route. The transition is then
  // retained + blocked and the next tick re-reconciles.
  let lastMutation: "apply" | "remove" | null = null;
  let verifyBlock: "route_removed" | "route_conflict" | null = null;
  let aborted = false;

  for (const action of decision.actions) {
    if (aborted) break;
    switch (action) {
      case "apply_route":
        deps.route.apply(deps.ownedUrl);
        lastMutation = "apply";
        break;
      case "remove_route":
        deps.route.removeExpected(deps.ownedUrl); // value-guarded
        lastMutation = "remove";
        break;
      case "verify_route": {
        const seen = deps.route.inspect(deps.ownedUrl);
        const ok = lastMutation === "remove" ? seen !== "exact" : seen === "exact";
        if (!ok) {
          aborted = true;
          verifyBlock = seen === "absent" ? "route_removed" : "route_conflict";
        }
        break;
      }
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

  // A failed read-back overrides the pure decision: the block reflects reality,
  // and the transition is retained (aborting before clear_transition already left
  // `transition` untouched) so the next tick retries rather than reporting done.
  const block = verifyBlock ?? decision.block;
  const error: ProxyControlErrorCode | null = verifyBlock
    ? verifyBlock === "route_conflict"
      ? "route_conflict"
      : "runtime_failed"
    : decision.error;

  return {
    ...control,
    routeLease: lease,
    drainingGeneration: drain,
    transition,
    reconcileBlocked: block ? { reason: block, at: nowIso } : control.reconcileBlocked,
    lastError: error ? { code: error, detail: null, at: nowIso } : control.lastError,
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
    const after = applyDecision(deps, before, decision);
    // Ready only when the transition actually cleared — a verify_route read-back
    // abort retains the transition, so decision.ready alone would over-report.
    ready = decision.ready && after.transition === null;
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

// One reconcile pass for the LIVE supervisor. It differs from runStartupRecovery
// only in that it also performs the two bootstrap-coordinator phase advances the
// pure recovery matrix intentionally leaves to the daemon (it cannot itself bind
// a listener): enable@intent/bootstrap → listener_healthy once the owned listener
// self-verifies, and listener_healthy → lease_installing after the lease install.
// Every other phase (lease_installing / route_verified / rollback / disable /
// drain) is delegated to the exhaustively-tested matrix. With no transition it
// runs the drift monitor. Callers MUST hold the transition lock.
const MAX_DRIVE_STEPS = 12;

export function superviseDrive(deps: SupervisorDeps): { ready: boolean } {
  let ready = false;
  for (let step = 0; step < MAX_DRIVE_STEPS; step++) {
    const control = readControlState(deps.storeRoot);
    const t = control.transition;
    if (t === null) {
      monitorTick(deps);
      return { ready };
    }
    const nowIso = new Date(deps.now()).toISOString();

    if (
      t.kind === "enable" &&
      (t.phase === "intent_persisted" || t.phase === "bootstrap_pending")
    ) {
      const healthy = deps.listener.isAlive() && deps.listener.healthCheck() === "matching";
      if (!healthy) return { ready }; // listener not up yet — retry next tick
      writeControlState(deps.storeRoot, {
        ...control,
        transition: { ...t, phase: "listener_healthy" },
        updatedAt: nowIso,
      });
      continue;
    }

    if (t.kind === "enable" && t.phase === "listener_healthy") {
      const obs = observeReality(deps, control);
      const decision = reconcileTransition(t, obs, control.desiredEnabled);
      const after = applyDecision(deps, control, decision);
      // Failed health degrades into a stop+block via the matrix (no lease to
      // advance). A matching health install_lease advances to lease_installing.
      writeControlState(
        deps.storeRoot,
        after.transition && obs.health === "matching"
          ? { ...after, transition: { ...t, phase: "lease_installing" }, updatedAt: nowIso }
          : after,
      );
      if (obs.health !== "matching") return { ready };
      continue;
    }

    const routeBefore = deps.route.inspect(deps.ownedUrl);
    const obs = observeReality(deps, control);
    const decision = reconcileTransition(t, obs, control.desiredEnabled);
    const after = applyDecision(deps, control, decision);
    ready = (decision.ready && after.transition === null) || ready;
    writeControlState(deps.storeRoot, after);
    if (after.transition === null) return { ready };
    const routeAfter = deps.route.inspect(deps.ownedUrl);
    if (sameState(control, after) && routeBefore === routeAfter) return { ready };
  }
  return { ready };
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
