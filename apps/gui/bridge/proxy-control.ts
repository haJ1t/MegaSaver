import { homedir } from "node:os";
import { join } from "node:path";
import {
  createClaudeRouteAdapter,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import {
  type LaunchctlRunner,
  type ProcessIdentityAdapter,
  type ProxyControlState,
  ensureManagedService,
  nodeLaunchctlRunner,
  nodeProcessIdentity,
  readControlState,
  withTransitionLock,
  writeControlState,
} from "@megasaver/proxy-control";

// The GUI no longer owns a listener or writes the route: the persistent
// supervisor (mega proxy supervise) owns routing. The toggle persists the
// operator's desired state and ensures the managed LaunchAgent, exactly like the
// CLI. It NEVER clears the route on bridge boot/shutdown — that stranding bug is
// gone; a persisted route survives the GUI process.
const OWNED_URL = "http://127.0.0.1:8787";

// Injectable so tests never touch real launchd or ~/.claude; the bridge uses the
// real defaults.
export type ProxyGuiDeps = {
  launchctl: LaunchctlRunner;
  plistPath: string;
  backupDir: string;
  superviseArgv: string[];
  settingsPath: string;
  // Optional so tests can pin time/identity and avoid shelling out for the lock.
  now?: () => number;
  identity?: ProcessIdentityAdapter;
};

export function defaultProxyGuiDeps(storeRoot: string): ProxyGuiDeps {
  const { MEGA_PROXY_SETTINGS_PATH } = process.env;
  return {
    launchctl: nodeLaunchctlRunner,
    plistPath: join(homedir(), "Library", "LaunchAgents", "com.megasaver.proxy.plist"),
    backupDir: join(storeRoot, "proxy", "migration-backups"),
    // Resolve the actual running script (process.argv[1]) so the LaunchAgent
    // re-invokes THIS binary, not a literal "mega" that need not be on PATH.
    // Mirrors apps/cli/src/commands/proxy/commands.ts. Fallback keeps dev-tsx.
    superviseArgv: [
      process.execPath,
      process.argv[1] ?? "mega",
      "proxy",
      "supervise",
      "--store",
      storeRoot,
    ],
    settingsPath: MEGA_PROXY_SETTINGS_PATH ?? resolveClaudeCodeSettingsPath(),
  };
}

export type ProxyStatus = {
  enabled: boolean;
  routed: boolean;
  routeConflict: boolean;
  reconcileBlocked: boolean;
  draining: boolean;
  url: string;
  error?: string;
};

export function proxyStatus(
  storeRoot: string,
  deps: ProxyGuiDeps = defaultProxyGuiDeps(storeRoot),
): ProxyStatus {
  const control = readControlState(storeRoot);
  const route = createClaudeRouteAdapter(deps.settingsPath).inspect(OWNED_URL);
  return {
    enabled: control.desiredEnabled,
    routed: route === "exact",
    routeConflict: route === "foreign",
    reconcileBlocked: control.reconcileBlocked !== null,
    draining: control.drainingGeneration !== null,
    url: OWNED_URL,
    ...(control.lastError ? { error: control.lastError.code } : {}),
  };
}

function guiTransitionOwner(startedAt: string) {
  return {
    id: "gui",
    ownerKind: "offline_cli" as const,
    ownerInstanceId: "gui",
    ownerProcessStartToken: "gui",
    ownerBootId: "gui",
    ownerFenceToken: "gui",
    handoffDeadline: null,
    startedAt,
  };
}

export function startProxy(
  storeRoot: string,
  deps: ProxyGuiDeps = defaultProxyGuiDeps(storeRoot),
): ProxyStatus {
  const service = ensureManagedService({
    plistPath: deps.plistPath,
    backupDir: deps.backupDir,
    runner: deps.launchctl,
    superviseArgv: deps.superviseArgv,
  });
  if (service.status === "legacy_service_present")
    return { ...proxyStatus(storeRoot, deps), error: "legacy_service_present" };
  if (service.status === "blocked") return { ...proxyStatus(storeRoot, deps), error: "blocked" };
  const now = deps.now?.() ?? Date.now();
  const locked = withTransitionLock(
    storeRoot,
    now,
    "start",
    () => {
      const control = readControlState(storeRoot);
      const nowIso = new Date(now).toISOString();
      writeControlState(storeRoot, {
        ...control,
        desiredEnabled: true,
        // Re-enabling supersedes any in-flight disable drain; drop the stale marker.
        drainingGeneration: null,
        transition: {
          ...guiTransitionOwner(nowIso),
          kind: "enable",
          phase: "intent_persisted",
          expectedUnrouted: false,
        },
        updatedAt: nowIso,
      });
    },
    deps.identity ?? nodeProcessIdentity,
  );
  if (locked.status === "locked")
    return { ...proxyStatus(storeRoot, deps), error: "transition_in_progress" };
  return proxyStatus(storeRoot, deps);
}

export function stopProxy(
  storeRoot: string,
  deps: ProxyGuiDeps = defaultProxyGuiDeps(storeRoot),
  opts: { confirmClientsRestarted?: boolean } = {},
): ProxyStatus {
  const now = deps.now?.() ?? Date.now();
  const locked = withTransitionLock(
    storeRoot,
    now,
    "stop",
    () => {
      const control = readControlState(storeRoot);
      const nowIso = new Date(now).toISOString();
      // A plain toggle-off enters drain (the listener stays up for an
      // already-launched client). A confirm-restarted call persists a
      // drain_complete transition so the supervisor stops its own listener and
      // reaches the terminal idle state — otherwise drain never completes.
      const transition: ProxyControlState["transition"] = opts.confirmClientsRestarted
        ? {
            ...guiTransitionOwner(nowIso),
            kind: "drain_complete",
            phase: "confirmation_persisted",
            expectedUnrouted: true,
          }
        : {
            ...guiTransitionOwner(nowIso),
            kind: "disable",
            phase: "unroute_expected",
            expectedUnrouted: true,
          };
      writeControlState(storeRoot, {
        ...control,
        desiredEnabled: false,
        transition,
        updatedAt: nowIso,
      });
    },
    deps.identity ?? nodeProcessIdentity,
  );
  if (locked.status === "locked")
    return { ...proxyStatus(storeRoot, deps), error: "transition_in_progress" };
  return proxyStatus(storeRoot, deps);
}
