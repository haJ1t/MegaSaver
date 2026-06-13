import type { MemoryScope } from "@megasaver/core";
import type { AgentId, RiskLevel } from "@megasaver/shared";

// ── Shared pill base ──────────────────────────────────────────────────────────
// All badges: inline-block, mono, xs uppercase tracking, rounded-sm pill.
const BASE = "inline-block px-2 py-0.5 text-xs font-medium rounded-sm tracking-wide leading-none";

// ── RiskBadge ─────────────────────────────────────────────────────────────────

const RISK_CLASS: Record<RiskLevel, string> = {
  low: "badge-risk-low",
  medium: "badge-risk-medium",
  high: "badge-risk-high",
  critical: "badge-risk-critical",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "low",
  medium: "med",
  high: "high",
  critical: "crit",
};

export function RiskBadge({ level }: { level: RiskLevel }): JSX.Element {
  return (
    <span className={`${BASE} ${RISK_CLASS[level]}`} aria-label={`Risk: ${level}`}>
      {RISK_LABEL[level]}
    </span>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

export type SessionStatus = "ended" | "open";

export function StatusBadge({ status }: { status: SessionStatus }): JSX.Element {
  const cls = status === "open" ? "badge-status-open" : "badge-status-ended";
  return (
    <span className={`${BASE} ${cls}`} aria-label={`Status: ${status}`}>
      {status}
    </span>
  );
}

// ── ScopeBadge ────────────────────────────────────────────────────────────────

const SCOPE_CLASS: Record<MemoryScope, string> = {
  project: "badge-scope-project",
  session: "badge-scope-session",
};

export function ScopeBadge({ scope }: { scope: MemoryScope }): JSX.Element {
  return (
    <span className={`${BASE} ${SCOPE_CLASS[scope]}`} aria-label={`Scope: ${scope}`}>
      {scope}
    </span>
  );
}

// ── AgentBadge ────────────────────────────────────────────────────────────────
// Agents share the muted-slate surface; they are metadata, not status.

const AGENT_LABEL: Record<AgentId, string> = {
  aider: "aider",
  "claude-code": "claude",
  codex: "codex",
  continue: "continue",
  cursor: "cursor",
  gemini: "gemini",
  "generic-cli": "cli",
  windsurf: "windsurf",
};

export function AgentBadge({ agentId }: { agentId: AgentId }): JSX.Element {
  return (
    <span className={`${BASE} badge-risk-low`} aria-label={`Agent: ${agentId}`}>
      {AGENT_LABEL[agentId]}
    </span>
  );
}
