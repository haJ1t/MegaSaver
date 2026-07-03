import { homedir } from "node:os";
import { join } from "node:path";
import {
  createClaudeRouteAdapter,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import { nodeLaunchctlRunner } from "@megasaver/proxy-control";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import {
  type ProxyControlPlaneDeps,
  runProxyServiceUninstall,
  runProxyStart,
  runProxyStatus,
  runProxyStop,
} from "./control.js";

const OWNED_URL = "http://127.0.0.1:8787";

function realDeps(storeFlag: string | undefined): ProxyControlPlaneDeps {
  const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
  return {
    storeRoot,
    route: createClaudeRouteAdapter(resolveClaudeCodeSettingsPath()),
    launchctl: nodeLaunchctlRunner,
    plistPath: join(homedir(), "Library", "LaunchAgents", "com.megasaver.proxy.plist"),
    backupDir: join(storeRoot, "proxy", "migration-backups"),
    superviseArgv: [
      process.execPath,
      process.argv[1] ?? "mega",
      "proxy",
      "supervise",
      "--store",
      storeRoot,
    ],
    ownedUrl: OWNED_URL,
    now: () => Date.now(),
  };
}

const storeArg = { store: { type: "string" as const, description: "Override store directory." } };

export const proxyStartCommand = defineCommand({
  meta: {
    name: "start",
    description:
      "Persistently enable the local proxy: install the supervisor LaunchAgent and route future Claude sessions.",
  },
  args: { ...storeArg },
  run({ args }) {
    const r = runProxyStart(realDeps(typeof args.store === "string" ? args.store : undefined));
    if (r.status === "legacy_service_present") {
      console.error(r.instruction);
      process.exitCode = 1;
      return;
    }
    if (r.status === "blocked") {
      console.error(`mega proxy: ${r.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`mega proxy: ${r.status} — restart Claude Code to pick up the route.`);
  },
});

export const proxyStopCommand = defineCommand({
  meta: {
    name: "stop",
    description: "Disable future proxy routing and enter drain for running clients.",
  },
  args: { ...storeArg },
  run({ args }) {
    runProxyStop(realDeps(typeof args.store === "string" ? args.store : undefined));
    console.log("mega proxy: disabled future routing; already-running clients keep draining.");
  },
});

export const proxyStatusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show separated proxy activation facts (enabled/routed/health/hooks).",
  },
  args: {
    ...storeArg,
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  run({ args }) {
    const st = runProxyStatus(realDeps(typeof args.store === "string" ? args.store : undefined));
    if (args.json) {
      console.log(JSON.stringify(st));
      return;
    }
    console.log(
      `enabled=${st.enabled} routed=${st.routed} conflict=${st.routeConflict} blocked=${st.reconcileBlocked}`,
    );
    console.log(`draining=${st.draining} hooks=${st.hooksConfigured} autostart=${st.autostart}`);
    console.log(`desktop=${st.desktopSupport} customUpstream=${st.customUpstream}`);
    if (st.error) console.log(`error: ${st.error.code}`);
  },
});

export const proxyServiceUninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove the dormant managed LaunchAgent (requires --confirm).",
  },
  args: {
    ...storeArg,
    confirm: {
      type: "boolean",
      default: false,
      description: "Confirm removal of the managed service.",
    },
  },
  run({ args }) {
    if (!args.confirm) {
      console.error("mega proxy service uninstall: pass --confirm to remove the managed service.");
      process.exitCode = 1;
      return;
    }
    const r = runProxyServiceUninstall(
      realDeps(typeof args.store === "string" ? args.store : undefined),
    );
    if (r.status === "blocked") {
      console.error(`mega proxy: ${r.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log("mega proxy: managed service uninstalled (plist moved to backup).");
  },
});

export const proxyServiceCommand = defineCommand({
  meta: { name: "service", description: "Manage the proxy supervisor LaunchAgent." },
  subCommands: { uninstall: proxyServiceUninstallCommand },
});
