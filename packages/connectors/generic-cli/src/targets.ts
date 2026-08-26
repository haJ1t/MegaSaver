import {
  type HandoffCapabilityProfile,
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  handoffCapabilityProfileSchema,
} from "@megasaver/connectors-shared";
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
  readonly handoff: HandoffCapabilityProfile;
}

const OPEN_HANDOFF_PROFILE: HandoffCapabilityProfile = Object.freeze({
  acceptsDiff: true,
  acceptsGitLine: true,
  maxBlockChars: null,
});

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
  handoff: OPEN_HANDOFF_PROFILE,
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
  handoff: OPEN_HANDOFF_PROFILE,
});

export const aiderTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
  // CONVENTIONS.md carries conventions; Aider derives its own diff context (spec OQ2).
  handoff: { acceptsDiff: false, acceptsGitLine: true, maxBlockChars: null },
});

export const geminiTarget = Object.freeze({
  id: "gemini",
  agentId: "gemini" satisfies AgentId,
  relativePath: "GEMINI.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const windsurfTarget = Object.freeze({
  id: "windsurf",
  agentId: "windsurf" satisfies AgentId,
  relativePath: ".windsurfrules",
  // ASSUMPTION A1 (spec OQ1): windsurf's rules-file ceiling; verify before ship.
  handoff: { acceptsDiff: true, acceptsGitLine: true, maxBlockChars: 6000 },
});

export const continueTarget = Object.freeze({
  id: "continue",
  agentId: "continue" satisfies AgentId,
  relativePath: ".continue/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

// harness-autodetect (2026-08-26): flat-file targets for the popular
// non-AGENTS.md-convention harnesses. The AGENTS.md-family harnesses
// (goose, crush, amp, iflow, droid, warp, zed) deliberately get NO target
// here — they share AGENTS.md, which the codex target already owns.
export const clineTarget = Object.freeze({
  id: "cline",
  agentId: "cline" satisfies AgentId,
  relativePath: ".clinerules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const rooCodeTarget = Object.freeze({
  id: "roo-code",
  agentId: "roo-code" satisfies AgentId,
  relativePath: ".roo/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const kiloCodeTarget = Object.freeze({
  id: "kilo-code",
  agentId: "kilo-code" satisfies AgentId,
  relativePath: ".kilocode/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const copilotTarget = Object.freeze({
  id: "copilot",
  agentId: "copilot" satisfies AgentId,
  relativePath: ".github/copilot-instructions.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const opencodeTarget = Object.freeze({
  id: "opencode",
  agentId: "opencode" satisfies AgentId,
  relativePath: ".opencode/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const amazonQTarget = Object.freeze({
  id: "amazon-q",
  agentId: "amazon-q" satisfies AgentId,
  relativePath: ".amazonq/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const qwenTarget = Object.freeze({
  id: "qwen",
  agentId: "qwen" satisfies AgentId,
  relativePath: "QWEN.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const traeTarget = Object.freeze({
  id: "trae",
  agentId: "trae" satisfies AgentId,
  relativePath: ".trae/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const antigravityTarget = Object.freeze({
  id: "antigravity",
  agentId: "antigravity" satisfies AgentId,
  relativePath: ".agent/rules/megasaver.md",
  handoff: OPEN_HANDOFF_PROFILE,
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
  geminiTarget,
  windsurfTarget,
  continueTarget,
  clineTarget,
  rooCodeTarget,
  kiloCodeTarget,
  copilotTarget,
  opencodeTarget,
  amazonQTarget,
  qwenTarget,
  traeTarget,
  antigravityTarget,
]);

// Validate all builtin targets at module load (catches external targets too when
// they call assertHeaderHasNoSentinels directly before registering).
for (const target of builtinTargets) {
  assertHeaderHasNoSentinels(target);
  handoffCapabilityProfileSchema.parse(target.handoff);
}

export function validateConnectorTarget(target: ConnectorTarget): void {
  assertHeaderHasNoSentinels(target);
  handoffCapabilityProfileSchema.parse(target.handoff);
}

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
