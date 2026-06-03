import { join } from "node:path";
import { parseBlock, readTargetFile } from "@megasaver/connectors-shared";
import type { KnownAgentId } from "@megasaver/mcp-bridge";
import { KNOWN_TARGETS } from "../../known-targets.js";

// Returns a resolver bound to a resolved project root. A block is
// "synced" when the connector file exists AND parseBlock finds the
// Mega Saver sentinel pair (block !== null). AA1 §5c.
export function makeConnectorSyncedResolver(projectRoot: string) {
  return async (agentId: KnownAgentId): Promise<boolean> => {
    const target = KNOWN_TARGETS.find((t) => t.id === agentId);
    if (target === undefined) return false;
    const existing = await readTargetFile(join(projectRoot, target.relativePath));
    if (existing === null) return false;
    return parseBlock(existing).block !== null;
  };
}
