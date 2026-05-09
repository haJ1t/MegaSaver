import type { AgentId } from "@megasaver/shared";
import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import { aiderTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";

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
] as const satisfies readonly ConnectorTarget[];

export const KNOWN_TARGET_IDS: readonly string[] = KNOWN_TARGETS.map((t) => t.id);

export type KnownTargetId = (typeof KNOWN_TARGETS)[number]["id"];

export function isKnownTargetId(value: string): value is KnownTargetId {
  return (KNOWN_TARGET_IDS as readonly string[]).includes(value);
}
