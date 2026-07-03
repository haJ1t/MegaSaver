import {
  type EnsureServiceResult,
  type LaunchctlRunner,
  type UninstallResult,
  ensureManagedService,
  readControlState,
  uninstallManagedService,
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
};

function launchAgentDeps(deps: ProxyControlPlaneDeps) {
  return {
    plistPath: deps.plistPath,
    backupDir: deps.backupDir,
    runner: deps.launchctl,
    superviseArgv: deps.superviseArgv,
  };
}

// `mega proxy start`: persist the operator's durable opt-in and ensure the
// supervisor LaunchAgent. A loaded legacy service is refused (never stopped); the
// supervisor completes the routing once it comes up.
export function runProxyStart(deps: ProxyControlPlaneDeps): EnsureServiceResult {
  const control = readControlState(deps.storeRoot);
  const service = ensureManagedService(launchAgentDeps(deps));
  if (service.status === "legacy_service_present" || service.status === "blocked") return service;
  writeControlState(deps.storeRoot, {
    ...control,
    desiredEnabled: true,
    updatedAt: new Date(deps.now()).toISOString(),
  });
  return service;
}

// `mega proxy stop`: disable future routing and enter drain. Persists the disable
// transition; the supervisor performs the value-guarded unroute + drain.
export function runProxyStop(deps: ProxyControlPlaneDeps): void {
  const control = readControlState(deps.storeRoot);
  const nowIso = new Date(deps.now()).toISOString();
  writeControlState(deps.storeRoot, {
    ...control,
    desiredEnabled: false,
    transition: {
      id: "stop",
      ownerKind: "offline_cli",
      ownerInstanceId: "cli",
      ownerProcessStartToken: "cli",
      ownerBootId: "cli",
      ownerFenceToken: "cli",
      handoffDeadline: null,
      startedAt: nowIso,
      kind: "disable",
      phase: "unroute_expected",
      expectedUnrouted: true,
    },
    updatedAt: nowIso,
  });
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
    hooksConfigured: deps.route.ensureHooks().configured,
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
