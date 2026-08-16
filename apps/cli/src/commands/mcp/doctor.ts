import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditMcpSecurity } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { HOOK_LOG_RELATIVE_PATH } from "../../hooks/logger.js";
import { resolveHomeDir } from "../../store.js";
import type { McpSecurityFinding } from "@megasaver/mcp-bridge";

export type RunMcpDoctorInput = {
  home: string;
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export function exitCodeForFindings(findings: readonly McpSecurityFinding[]): 0 | 1 {
  return findings.some((f) => f.severity === "critical" || f.severity === "high") ? 1 : 0;
}

export async function runMcpDoctor(input: RunMcpDoctorInput): Promise<0 | 1> {
  let hookLogContent: string | null = null;
  try {
    hookLogContent = await readFile(join(input.cwd, HOOK_LOG_RELATIVE_PATH), "utf8");
  } catch {
    hookLogContent = null;
  }

  const report = await auditMcpSecurity({
    home: input.home,
    hookLogContent,
    platform: process.platform,
  });

  if (input.json) {
    input.stdout(JSON.stringify(report));
  } else {
    for (const agent of report.agents) {
      const present = agent.present ? agent.serverKeys.join(", ") || "(no servers)" : "absent";
      input.stdout(`${agent.agentId}: ${agent.configPath} — ${present}`);
    }
    input.stdout("");
    for (const finding of report.findings) {
      const row = [
        finding.severity.toUpperCase().padEnd(8),
        finding.checkId.padEnd(18),
        (finding.agentId ?? "-").padEnd(14),
        (finding.serverKey ?? "-").padEnd(14),
        (finding.toolName ?? "-").padEnd(18),
        finding.message,
      ].join("  ");
      input.stdout(row);
      input.stdout(`  remediation: ${finding.remediation}`);
    }
    const counts: Record<string, number> = {};
    for (const f of report.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    const summary = `${report.findings.length} findings (${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.medium ?? 0} medium, ${counts.low ?? 0} low, ${counts.info ?? 0} info) — usage evidence: ${report.usageEvidence}`;
    input.stdout(summary);
  }

  return exitCodeForFindings(report.findings);
}

export const mcpDoctorCommand = defineCommand({
  meta: { name: "doctor", description: "Audit the local MCP security surface." },
  args: {
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpDoctor({
      home: resolveHomeDir(),
      cwd: process.cwd(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: args.json === true,
    });
    if (code !== 0) process.exitCode = code;
  },
});
