import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { aiderTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";
import type { AgentId } from "@megasaver/shared";

export const CLAUDE_CODE_TARGET = {
  id: "claude-code",
  agentId: "claude-code" satisfies AgentId,
  relativePath: "CLAUDE.md",
} as const;

// claude-code lives in @megasaver/connector-claude-code; codex/cursor/aider live in @megasaver/connector-generic-cli; this aggregates across packages.
export const KNOWN_TARGETS = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
] as const satisfies readonly ConnectorTarget[];

export const KNOWN_TARGET_IDS: readonly string[] = KNOWN_TARGETS.map((t) => t.id);

export type KnownTargetId = (typeof KNOWN_TARGETS)[number]["id"];

export function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}
