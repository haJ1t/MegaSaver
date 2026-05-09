import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}

export const codexTarget: ConnectorTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget: ConnectorTarget = Object.freeze({
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
    "",
  ].join("\n"),
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
