import { homedir } from "node:os";
import { join } from "node:path";
import {
  createClaudeRouteAdapter,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import {
  type LaunchctlRunner,
  ensureManagedService,
  nodeLaunchctlRunner,
  readControlState,
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
};

export function defaultProxyGuiDeps(storeRoot: string): ProxyGuiDeps {
  const { MEGA_PROXY_SETTINGS_PATH } = process.env;
  return {
    launchctl: nodeLaunchctlRunner,
    plistPath: join(homedir(), "Library", "LaunchAgents", "com.megasaver.proxy.plist"),
    backupDir: join(storeRoot, "proxy", "migration-backups"),
    superviseArgv: [process.execPath, "mega", "proxy", "supervise", "--store", storeRoot],
    settingsPath: MEGA_PROXY_SETTINGS_PATH ?? resolveClaudeCodeSettingsPath(),
  };
}

export type ProxyStatus = {
  enabled: boolean;
  routed: boolean;
  routeConflict: boolean;
  reconcileBlocked: boolean;
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
    ...(control.lastError ? { error: control.lastError.code } : {}),
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
  const control = readControlState(storeRoot);
  writeControlState(storeRoot, {
    ...control,
    desiredEnabled: true,
    updatedAt: new Date().toISOString(),
  });
  return proxyStatus(storeRoot, deps);
}

export function stopProxy(
  storeRoot: string,
  deps: ProxyGuiDeps = defaultProxyGuiDeps(storeRoot),
): ProxyStatus {
  const control = readControlState(storeRoot);
  const nowIso = new Date().toISOString();
  writeControlState(storeRoot, {
    ...control,
    desiredEnabled: false,
    transition: {
      id: "gui-stop",
      ownerKind: "offline_cli",
      ownerInstanceId: "gui",
      ownerProcessStartToken: "gui",
      ownerBootId: "gui",
      ownerFenceToken: "gui",
      handoffDeadline: null,
      startedAt: nowIso,
      kind: "disable",
      phase: "unroute_expected",
      expectedUnrouted: true,
    },
    updatedAt: nowIso,
  });
  return proxyStatus(storeRoot, deps);
}
