import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import {
  aiderTarget,
  codexTarget,
  continueTarget,
  cursorTarget,
  geminiTarget,
  windsurfTarget,
} from "@megasaver/connector-generic-cli";
import type { AgentId } from "@megasaver/shared";

// GUI-local mirror of apps/cli/src/known-targets.ts so the bridge can
// resolve a connector file path per agent without importing the CLI
// (apps do not depend on apps; AA1 §3). Keep in sync with the CLI list.
export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;

export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
] as const satisfies readonly ConnectorTarget[];
