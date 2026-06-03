import type { KnownAgentId } from "./agent-ids.js";
import { installMcp, uninstallMcp } from "./install.js";
import {
  type ConnectorSyncedResolver,
  type McpStatusResult,
  aggregateMcpStatus,
} from "./status.js";

// F2 (critic-locked): the high-level facade BB11 consumes. Every
// op returns a fresh post-op McpStatusResult snapshot (LL
// re-fetch-on-mutation; AA1 §1 non-goal "real-time push").
export interface McpSetupOps {
  status(): Promise<McpStatusResult>;
  install(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  repair(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  uninstall(target: KnownAgentId): Promise<McpStatusResult>;
}

export type BuildMcpSetupOpsDeps = {
  home: string;
  command: string;
  // Launch args written alongside command so the config is runnable
  // (e.g. ["mcp", "serve"]). Defaults to the CLI default when omitted.
  args?: string[];
  connectorSyncedResolver: ConnectorSyncedResolver;
  // AA1 §5c: repair = install + connector sync for that agent. The
  // sync needs KNOWN_TARGETS + the registry (CLI/GUI), so it is
  // injected — keeps the facade free of CLI coupling (§2c DI).
  connectorSync: (target: KnownAgentId, project: string) => Promise<void>;
};

export function buildMcpSetupOps(deps: BuildMcpSetupOpsDeps): McpSetupOps {
  const snapshot = (): Promise<McpStatusResult> =>
    aggregateMcpStatus({ home: deps.home, connectorSyncedResolver: deps.connectorSyncedResolver });

  const install = (target: KnownAgentId): Promise<unknown> =>
    installMcp({
      agentId: target,
      home: deps.home,
      command: deps.command,
      ...(deps.args !== undefined ? { args: deps.args } : {}),
    });

  return {
    status() {
      return snapshot();
    },
    async install(target, _project) {
      await install(target);
      return snapshot();
    },
    async repair(target, project) {
      await install(target);
      await deps.connectorSync(target, project); // AA1 §5c second effect
      return snapshot();
    },
    async uninstall(target) {
      await uninstallMcp({ agentId: target, home: deps.home });
      return snapshot();
    },
  };
}
