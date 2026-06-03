import type { KnownAgentId } from "./agent-ids.js";
import { type InstallResult, installMcp } from "./install.js";

export type RepairResult = {
  install: InstallResult;
  // connector sync is performed by the CLI (which owns
  // KNOWN_TARGETS + the registry); repair signals the caller to
  // run it. AA1 §5c: "install + connector sync, one call".
  connectorSyncRequested: true;
};

export async function repairMcp(input: {
  agentId: KnownAgentId;
  home: string;
  command: string;
  args?: string[];
}): Promise<RepairResult> {
  const install = await installMcp(input);
  return { install, connectorSyncRequested: true };
}
