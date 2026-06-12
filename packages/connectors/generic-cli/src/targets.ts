import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "@megasaver/connectors-shared";
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}

// Guard: a header containing a sentinel string would corrupt every generated
// file the connector writes. Fail at module load rather than silently at sync time.
function assertHeaderHasNoSentinels(target: ConnectorTarget): void {
  if (target.header === undefined) return;
  if (
    target.header.includes(MEGA_SAVER_BLOCK_START) ||
    target.header.includes(MEGA_SAVER_BLOCK_END)
  ) {
    throw new Error(
      `ConnectorTarget "${target.id}" header must not contain Mega Saver sentinel strings.`,
    );
  }
}

export const codexTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [
    "---",
    "description: Mega Saver project context (auto-managed block)",
    "alwaysApply: true",
    "---",
    "",
    "",
  ].join("\n"),
});

export const aiderTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
});

export const geminiTarget = Object.freeze({
  id: "gemini",
  agentId: "gemini" satisfies AgentId,
  relativePath: "GEMINI.md",
});

export const windsurfTarget = Object.freeze({
  id: "windsurf",
  agentId: "windsurf" satisfies AgentId,
  relativePath: ".windsurfrules",
});

export const continueTarget = Object.freeze({
  id: "continue",
  agentId: "continue" satisfies AgentId,
  relativePath: ".continue/rules/megasaver.md",
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
]);

// Validate all builtin targets at module load (catches external targets too when
// they call assertHeaderHasNoSentinels directly before registering).
for (const target of builtinTargets) {
  assertHeaderHasNoSentinels(target);
}

export function validateConnectorTarget(target: ConnectorTarget): void {
  assertHeaderHasNoSentinels(target);
}

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
