import { existsSync } from "node:fs";
import {
  BrainSyncError,
  configPath,
  deriveBrainId,
  keyfilePath,
  loadConfig,
  loadKeyfile,
} from "@megasaver/brain-sync";
import type { ClaudeCodeHookStatus } from "@megasaver/connector-claude-code";
import type { DoctorFinding } from "@megasaver/core";

export function buildHookCoverageFindings(
  status: ClaudeCodeHookStatus,
  settingsPath: string,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (!status.connected) {
    const missing: string[] = [];
    if (!status.preInstalled) missing.push("pre");
    if (!status.postInstalled) missing.push("post");
    if (!status.intentInstalled) missing.push("intent");
    const msg =
      missing.length > 0
        ? `hooks not connected missing ${missing.join(", ")}`
        : "hooks not connected";
    findings.push({
      check: "hook-coverage",
      severity: "warn",
      message: msg,
      evidence: { files: [settingsPath] },
      repair: "mega hooks install claude-code",
    });
    return findings;
  }
  // connected, check optional hooks
  if (!status.warmupInstalled) {
    findings.push({
      check: "hook-coverage",
      severity: "info",
      message: "warmup hook missing",
      evidence: { files: [settingsPath] },
      repair: "mega hooks install claude-code",
    });
  }
  if (!status.guardInstalled) {
    findings.push({
      check: "hook-coverage",
      severity: "info",
      message: "guard hook missing",
      evidence: { files: [settingsPath] },
      repair: "mega hooks install claude-code",
    });
  }
  if (!status.cacheAdviceInstalled) {
    findings.push({
      check: "hook-coverage",
      severity: "info",
      message: "cache-advice hook missing",
      evidence: { files: [settingsPath] },
      repair: "mega hooks install claude-code",
    });
  }
  return findings;
}

export type SyncFreshnessInput = { storeRoot: string; projectName: string };

export function buildSyncFreshnessFindings(input: SyncFreshnessInput): DoctorFinding[] {
  const cfgPath = configPath(input.storeRoot);
  if (!existsSync(cfgPath)) {
    return [
      {
        check: "sync-freshness",
        severity: "info",
        message: "sync not configured",
        evidence: { files: [cfgPath] },
        repair: `mega brain sync init ${input.projectName}`,
      },
    ];
  }
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig(input.storeRoot);
  } catch (err) {
    if (err instanceof BrainSyncError) {
      return [
        {
          check: "sync-freshness",
          severity: "warn",
          message: `sync config invalid: ${err.message}`,
          evidence: { files: [cfgPath] },
          repair: `mega brain sync init ${input.projectName}`,
        },
      ];
    }
    throw err;
  }
  let key: ReturnType<typeof loadKeyfile> | null = null;
  try {
    key = loadKeyfile(keyfilePath(input.storeRoot));
  } catch (err) {
    if (err instanceof BrainSyncError) {
      return [
        {
          check: "sync-freshness",
          severity: "warn",
          message: `keyfile problem: ${err.message}`,
          evidence: { files: [keyfilePath(input.storeRoot)] },
          repair: `mega brain sync init ${input.projectName}`,
        },
      ];
    }
    throw err;
  }
  const brainId = deriveBrainId(key as never, input.projectName);
  const gen = (cfg.lastSeen as Record<string, number>)[brainId] ?? 0;
  if (gen === 0) {
    return [
      {
        check: "sync-freshness",
        severity: "warn",
        message: "never synced",
        evidence: { files: [cfgPath] },
        repair: `mega brain sync push ${input.projectName}`,
      },
    ];
  }
  return [
    {
      check: "sync-freshness",
      severity: "info",
      message: `synced generation ${gen}`,
      evidence: { files: [cfgPath] },
      repair: `mega brain sync status ${input.projectName}`,
    },
  ];
}
