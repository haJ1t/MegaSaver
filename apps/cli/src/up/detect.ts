import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HookCommandConfig,
  planClaudeCodeHookInstall,
  readClaudeCodeHookStatus,
} from "@megasaver/connector-claude-code";
import type { ConnectorTarget } from "@megasaver/connectors-shared";
import {
  normalizeEol,
  parseBlock,
  readTargetFile,
  upsertBlock,
} from "@megasaver/connectors-shared";
import {
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
} from "@megasaver/context-gate";
import type { TokenSaverMode } from "@megasaver/shared";
import { buildConnectorContext } from "../commands/connector/shared.js";
import { findProjectByCwd } from "../commands/warmup.js";
import { ensureStoreReady } from "../store.js";

export type UpHooksDetect =
  | { kind: "unreadable"; message: string }
  | { kind: "readable"; changed: boolean; priorConnected: boolean };

export type UpTargetDetect = {
  id: string;
  relativePath: string;
  prior: "missing" | "no-block" | "block";
  inSync: boolean;
};

export type UpDetectedState = {
  settingsPath: string;
  hooks: UpHooksDetect;
  saver: { enabled: boolean; mode: TokenSaverMode };
  targets: UpTargetDetect[];
};

export async function detectUpState(input: {
  settingsPath: string;
  storeRoot: string;
  cwd: string;
  targets: readonly ConnectorTarget[];
  config: HookCommandConfig;
  platform: NodeJS.Platform;
}): Promise<UpDetectedState> {
  let hooks: UpHooksDetect;
  if (existsSync(input.settingsPath)) {
    try {
      JSON.parse(readFileSync(input.settingsPath, "utf8"));
      const planned = planClaudeCodeHookInstall({
        settingsPath: input.settingsPath,
        config: input.config,
        platform: input.platform,
      });
      const status = readClaudeCodeHookStatus({
        settingsPath: input.settingsPath,
        config: input.config,
        platform: input.platform,
      });
      hooks = {
        kind: "readable",
        changed: planned.changed,
        priorConnected: status.connected,
      };
    } catch (err) {
      hooks = {
        kind: "unreadable",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    const planned = planClaudeCodeHookInstall({
      settingsPath: input.settingsPath,
      config: input.config,
      platform: input.platform,
    });
    hooks = {
      kind: "readable",
      changed: planned.changed,
      priorConnected: false,
    };
  }

  const saverResolved = resolveWorkspaceTokenSaverSettings(
    input.storeRoot,
    input.cwd,
    nodeResolverDeps(),
  );
  const saver = {
    enabled: saverResolved.enabled,
    mode: saverResolved.mode,
  };

  let ready: Awaited<ReturnType<typeof ensureStoreReady>> | null = null;
  try {
    ready = await ensureStoreReady(input.storeRoot);
  } catch {
    ready = null;
  }

  const project = ready ? findProjectByCwd(ready.registry.listProjects(), input.cwd) : null;
  const sessions = project && ready ? ready.registry.listSessions(project.id) : [];
  const memoryEntries = project && ready ? ready.registry.listMemoryEntries(project.id) : [];

  const targets: UpTargetDetect[] = [];
  const now = () => new Date();

  for (const target of input.targets) {
    const absPath = join(input.cwd, target.relativePath);
    const existing = await readTargetFile(absPath);
    if (existing === null) {
      targets.push({
        id: target.id,
        relativePath: target.relativePath,
        prior: "missing",
        inSync: false,
      });
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      targets.push({
        id: target.id,
        relativePath: target.relativePath,
        prior: "no-block",
        inSync: false,
      });
      continue;
    }

    let inSync = false;
    if (project !== null) {
      const context = buildConnectorContext(target, project, sessions, memoryEntries, now);
      const upserted = upsertBlock({ existingContent: existing, context });
      inSync = normalizeEol(upserted) === normalizeEol(existing);
    }
    targets.push({
      id: target.id,
      relativePath: target.relativePath,
      prior: "block",
      inSync,
    });
  }

  return {
    settingsPath: input.settingsPath,
    hooks,
    saver,
    targets,
  };
}
