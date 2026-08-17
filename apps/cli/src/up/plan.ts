import type { TokenSaverMode } from "@megasaver/shared";
import type { UpDetectedState, UpTargetDetect } from "./detect.js";

export type UpAction = "install" | "repair" | "ok" | "conflict";

export type UpPlan = {
  hooks: { action: UpAction; detail: string };
  connector: { action: UpAction; targets: UpTargetDetect[]; detail: string };
  saver: { action: UpAction; mode: TokenSaverMode; detail: string };
  hasWork: boolean;
  hasConflict: boolean;
};

function connectorDetail(targets: UpTargetDetect[]): string {
  return targets.map((t) => `${t.relativePath} (${t.prior}, ${t.inSync ? "in-sync" : "out-of-sync"})`).join(", ");
}

function saverDetail(saver: { enabled: boolean; mode: TokenSaverMode }, desiredMode: TokenSaverMode): string {
  if (!saver.enabled) return `enable (${desiredMode})`;
  if (saver.mode !== desiredMode) return `mode change: ${saver.mode} -> ${desiredMode}`;
  return `${saver.mode} (already enabled)`;
}

export function buildUpPlan(state: UpDetectedState, mode: TokenSaverMode): UpPlan {
  const hooks =
    state.hooks.kind === "unreadable"
      ? { action: "conflict" as const, detail: `unreadable settings: ${state.hooks.message}` }
      : {
          action: state.hooks.changed
            ? state.hooks.priorConnected
              ? ("repair" as const)
              : ("install" as const)
            : ("ok" as const),
          detail: state.settingsPath,
        };

  const connectorAction: UpAction = state.targets.some((t) => t.prior !== "block")
    ? "install"
    : state.targets.every((t) => t.inSync)
      ? "ok"
      : "repair";

  const saverAction: UpAction = !state.saver.enabled
    ? "install"
    : state.saver.mode === mode
      ? "ok"
      : "repair";

  const actions = [hooks.action, connectorAction, saverAction];

  return {
    hooks,
    connector: {
      action: connectorAction,
      targets: state.targets,
      detail: connectorDetail(state.targets),
    },
    saver: {
      action: saverAction,
      mode,
      detail: saverDetail(state.saver, mode),
    },
    hasWork: actions.some((a) => a === "install" || a === "repair"),
    hasConflict: actions.includes("conflict"),
  };
}

export function renderUpPlan(plan: UpPlan): string[] {
  const lines: string[] = [];

  // Hooks line
  if (plan.hooks.action === "conflict") {
    lines.push(`hooks:     conflict (${plan.hooks.detail}) — fix manually before running mega up`);
  } else {
    lines.push(`hooks:     ${plan.hooks.action.padEnd(8)} ${plan.hooks.detail}`);
  }

  // Connector targets
  for (const t of plan.connector.targets) {
    const action = t.prior !== "block" ? "install" : t.inSync ? "ok" : "repair";
    lines.push(`connector: ${action.padEnd(8)} ${t.relativePath} (${t.prior})`);
  }

  // Saver line
  lines.push(`saver:     ${plan.saver.action.padEnd(8)} ${plan.saver.detail}`);

  return lines;
}
