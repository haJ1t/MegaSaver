import {
  type EnsureServiceResult,
  type LaunchctlRunner,
  type ProcessIdentityAdapter,
  type ProxyControlState,
  type UninstallResult,
  ensureManagedService,
  nodeProcessIdentity,
  readControlState,
  uninstallManagedService,
  withTransitionLock,
  writeControlState,
} from "@megasaver/proxy-control";
import { readSaverTelemetry } from "./saver-telemetry.js";

// The route surface the control plane needs (satisfied by the connector's
// ClaudeRouteAdapter). Kept minimal so the CLI stays the only place agent-specific
// wiring meets proxy-control.
export type RouteSurface = {
  inspect(url: string): "absent" | "exact" | "foreign" | "invalid";
  apply(url: string): void;
  removeExpected(url: string): void;
  ensureHooks(): { configured: boolean; error?: string };
  inspectHooks(): boolean;
};

export type ProxyControlPlaneDeps = {
  storeRoot: string;
  route: RouteSurface;
  launchctl: LaunchctlRunner;
  plistPath: string;
  backupDir: string;
  superviseArgv: string[];
  ownedUrl: string;
  now: () => number;
  // Injected so tests don't shell out to ps/sysctl for the transition lock.
  identity?: ProcessIdentityAdapter;
};

function launchAgentDeps(deps: ProxyControlPlaneDeps) {
  return {
    plistPath: deps.plistPath,
    backupDir: deps.backupDir,
    runner: deps.launchctl,
    superviseArgv: deps.superviseArgv,
  };
}

export type StartResult = EnsureServiceResult | { status: "transition_in_progress" };
export type StopResult = { status: "ok" } | { status: "transition_in_progress" };

// `mega proxy start`: persist the operator's durable opt-in + a fresh enable
// intent and ensure the supervisor LaunchAgent. A loaded legacy service is
// refused (never stopped). The control write is serialized under the transition
// lock so it can neither race a concurrent writer nor clobber an in-flight
// transition the supervisor is actively reconciling.
export function runProxyStart(deps: ProxyControlPlaneDeps): StartResult {
  const service = ensureManagedService(launchAgentDeps(deps));
  if (service.status === "legacy_service_present" || service.status === "blocked") return service;
  const locked = withTransitionLock(
    deps.storeRoot,
    deps.now(),
    "start",
    () => {
      const control = readControlState(deps.storeRoot);
      const nowIso = new Date(deps.now()).toISOString();
      writeControlState(deps.storeRoot, {
        ...control,
        desiredEnabled: true,
        // Re-enabling supersedes any in-flight disable drain; drop the stale
        // draining marker so status doesn't report draining + routed at once.
        drainingGeneration: null,
        transition: {
          ...cliTransitionOwner(nowIso),
          kind: "enable",
          phase: "intent_persisted",
          expectedUnrouted: false,
        },
        updatedAt: nowIso,
      });
    },
    deps.identity ?? nodeProcessIdentity,
  );
  return locked.status === "locked" ? { status: "transition_in_progress" } : service;
}

// `mega proxy stop`: disable future routing and enter drain. Persists the disable
// transition under the transition lock; the supervisor performs the value-guarded
// unroute + drain. The listener stays up (an already-launched Claude keeps using
// the proxy until restarted) until the operator confirms clients were restarted.
//
// `mega proxy stop --confirm-clients-restarted`: the operator's acknowledgement
// that no live client still points at the proxy. Persists a drain_complete
// transition so the supervisor stops its own key-holding listener and clears the
// transition, reaching the terminal idle state (without this, drain never
// completes: the listener lingers and `service uninstall` stays blocked).
export function runProxyStop(
  deps: ProxyControlPlaneDeps,
  opts: { confirmClientsRestarted?: boolean } = {},
): StopResult {
  const locked = withTransitionLock(
    deps.storeRoot,
    deps.now(),
    "stop",
    () => {
      const control = readControlState(deps.storeRoot);
      const nowIso = new Date(deps.now()).toISOString();
      const transition: ProxyControlState["transition"] = opts.confirmClientsRestarted
        ? {
            ...cliTransitionOwner(nowIso),
            kind: "drain_complete",
            phase: "confirmation_persisted",
            expectedUnrouted: true,
          }
        : {
            ...cliTransitionOwner(nowIso),
            kind: "disable",
            phase: "unroute_expected",
            expectedUnrouted: true,
          };
      writeControlState(deps.storeRoot, {
        ...control,
        desiredEnabled: false,
        transition,
        updatedAt: nowIso,
      });
    },
    deps.identity ?? nodeProcessIdentity,
  );
  return locked.status === "locked" ? { status: "transition_in_progress" } : { status: "ok" };
}

// The transition RECORD owner fields are sentinels: the real single-writer
// guarantee comes from the transition.lock (fenced, process-identity based), not
// from these fields.
function cliTransitionOwner(startedAt: string) {
  return {
    id: "cli",
    ownerKind: "offline_cli" as const,
    ownerInstanceId: "cli",
    ownerProcessStartToken: "cli",
    ownerBootId: "cli",
    ownerFenceToken: "cli",
    handoffDeadline: null,
    startedAt,
  };
}

export type ProxyActivationStatus = {
  enabled: boolean;
  routed: boolean;
  routeConflict: boolean;
  reconcileBlocked: boolean;
  draining: boolean;
  hooksConfigured: boolean;
  customUpstream: boolean;
  autostart: "running" | "dormant" | "missing";
  routeCapability: "settings-configured";
  desktopSupport: "unverified";
  lastSaverHookInvocationAt: string | null;
  lastSaverHookInvocationAgeMs: number | null;
  lastCompressionAt: string | null;
  lastCompressionAgeMs: number | null;
  error: { code: string; detail: string | null; at: string } | null;
};

const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export function runProxyStatus(deps: ProxyControlPlaneDeps): ProxyActivationStatus {
  const control = readControlState(deps.storeRoot);
  const route = deps.route.inspect(deps.ownedUrl);
  const job = deps.launchctl.print("com.megasaver.proxy");
  return {
    enabled: control.desiredEnabled,
    routed: route === "exact",
    routeConflict: route === "foreign",
    reconcileBlocked: control.reconcileBlocked !== null,
    draining: control.drainingGeneration !== null,
    hooksConfigured: deps.route.inspectHooks(),
    customUpstream: control.upstreamBaseUrl !== DEFAULT_UPSTREAM,
    autostart: job !== null ? "running" : "missing",
    routeCapability: "settings-configured",
    desktopSupport: "unverified",
    ...readSaverTelemetry(deps.storeRoot, deps.now()),
    error: control.lastError,
  };
}

// `mega proxy service uninstall --confirm`: only a dormant managed service when
// desired is disabled and nothing is in flight.
export function runProxyServiceUninstall(
  deps: ProxyControlPlaneDeps,
): UninstallResult | { status: "blocked"; reason: string } {
  const control = readControlState(deps.storeRoot);
  if (control.desiredEnabled || control.routeLease !== null || control.transition !== null) {
    return { status: "blocked", reason: "proxy is enabled or has work in flight" };
  }
  return uninstallManagedService(launchAgentDeps(deps));
}
