import { z } from "zod";
import type { KnownAgentId } from "../setup/agent-ids.js";

export const mcpFindingSeveritySchema = z.enum([
  "critical",
  "high",
  "info",
  "low",
  "medium",
]);
export type McpFindingSeverity = z.infer<typeof mcpFindingSeveritySchema>;

export const SEVERITY_RANK: Record<McpFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const mcpDoctorCheckIdSchema = z.enum([
  "clone_shadowing",
  "config_surface",
  "description_hygiene",
  "over_privilege",
]);
export type McpDoctorCheckId = z.infer<typeof mcpDoctorCheckIdSchema>;

export const mcpFindingCodeSchema = z.enum([
  "capability_exec",
  "capability_network",
  "capability_write",
  "clone_exact",
  "clone_near",
  "config_group_writable",
  "config_unreadable",
  "config_world_writable",
  "description_injection",
  "description_url_instruction",
  "evidence_gap",
  "inventory_truncated",
  "non_localhost_url",
  "shadows_bridge_tool",
]);
export type McpFindingCode = z.infer<typeof mcpFindingCodeSchema>;

export type McpSecurityFinding = {
  checkId: McpDoctorCheckId;
  code: McpFindingCode;
  severity: McpFindingSeverity;
  agentId?: KnownAgentId;
  serverKey?: string;
  toolName?: string;
  message: string;
  remediation: string;
};

export type McpAgentConfigSurface = {
  agentId: KnownAgentId;
  configPath: string;
  present: boolean;
  serverKeys: string[];
};

export const usageEvidenceSchema = z.enum(["hook-log", "none"]);
export type UsageEvidence = z.infer<typeof usageEvidenceSchema>;

export type McpSecurityReport = {
  generatedAt: string;
  agents: McpAgentConfigSurface[];
  findings: McpSecurityFinding[];
  usageEvidence: UsageEvidence;
};

export function compareFindings(a: McpSecurityFinding, b: McpSecurityFinding): number {
  const rankA = SEVERITY_RANK[a.severity];
  const rankB = SEVERITY_RANK[b.severity];
  if (rankA !== rankB) return rankA - rankB;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const agentA = a.agentId ?? "";
  const agentB = b.agentId ?? "";
  if (agentA !== agentB) return agentA < agentB ? -1 : 1;
  const serverA = a.serverKey ?? "";
  const serverB = b.serverKey ?? "";
  if (serverA !== serverB) return serverA < serverB ? -1 : 1;
  const toolA = a.toolName ?? "";
  const toolB = b.toolName ?? "";
  if (toolA !== toolB) return toolA < toolB ? -1 : 1;
  return 0;
}
