import { TOOL_DEFS } from "../server.js";
import { capabilitiesOf } from "./capability.js";
import { detectClones } from "./clones.js";
import { readConfigSurface } from "./config-surface.js";
import { parseMcpHookLog } from "./hook-evidence.js";
import { scanDescription } from "./hygiene.js";
import { type McpSecurityFinding, type McpSecurityReport, compareFindings } from "./report.js";

export type McpSecurityAuditInput = {
  home: string;
  hookLogContent: string | null;
  platform?: NodeJS.Platform;
  now?: () => Date;
};

export async function auditMcpSecurity(input: McpSecurityAuditInput): Promise<McpSecurityReport> {
  const platform = input.platform ?? process.platform;
  const now = input.now ?? (() => new Date());

  const config = await readConfigSurface({ home: input.home, platform });
  const findings: McpSecurityFinding[] = [...config.findings];

  // Hook-log evidence
  let usageEvidence: McpSecurityReport["usageEvidence"] = "none";
  const hookEvidence = input.hookLogContent !== null ? parseMcpHookLog(input.hookLogContent) : null;
  if (hookEvidence !== null) {
    usageEvidence = "hook-log";
    // Per observed third-party tool: capability findings (low)
    for (const [serverKey, tools] of hookEvidence.servers) {
      for (const [toolName, count] of tools) {
        const caps = capabilitiesOf(toolName);
        for (const cap of caps) {
          findings.push({
            checkId: "over_privilege",
            code:
              cap === "write"
                ? "capability_write"
                : cap === "exec"
                  ? "capability_exec"
                  : "capability_network",
            severity: "low",
            serverKey,
            toolName,
            message: `"${toolName}" on "${serverKey}" has ${cap} capability (observed ${count} calls)`,
            remediation: "verify the capability is needed; remove unused servers",
          });
        }
      }
    }
    // Configured but never observed third-party servers: unknown inventory
    const observedServers = new Set(hookEvidence.servers.keys());
    for (const srv of config.servers) {
      if (srv.isMegaBridge) continue;
      if (!observedServers.has(srv.serverKey)) {
        findings.push({
          checkId: "over_privilege",
          code: "evidence_gap",
          severity: "info",
          serverKey: srv.serverKey,
          message: `inventory and usage unknown for "${srv.serverKey}" — no handshake in v1`,
          remediation: "no handshake in v1 — run tools/list manually or wait for v2 probe",
        });
      }
    }
    // Bridge: usage unknown by design (self-log exclusion)
    findings.push({
      checkId: "over_privilege",
      code: "evidence_gap",
      severity: "info",
      serverKey: "megasaver",
      message: "bridge usage unobservable: self-log exclusion (hooks/logger.ts)",
      remediation: "bridge capabilities are audited statically; usage is not logged by design",
    });
  } else {
    findings.push({
      checkId: "over_privilege",
      code: "evidence_gap",
      severity: "info",
      message: "usage evidence: none — no hook log",
      remediation: "mega hooks install — usage claims only when a hook log exists",
    });
  }

  // Clone / shadow pool: observed third-party tools
  if (hookEvidence !== null) {
    const observedTools: { serverKey: string; toolName: string }[] = [];
    for (const [serverKey, tools] of hookEvidence.servers) {
      for (const toolName of tools.keys()) {
        observedTools.push({ serverKey, toolName });
      }
    }
    findings.push(...detectClones(observedTools));
  }

  // Description hygiene over our own TOOL_DEFS (dogfood)
  for (const def of TOOL_DEFS) {
    const hits = scanDescription(def.description);
    for (const hit of hits) {
      findings.push({
        checkId: "description_hygiene",
        code: hit.kind === "injection" ? "description_injection" : "description_url_instruction",
        severity: "high",
        serverKey: "megasaver",
        toolName: def.id,
        message: `"${def.id}": ${hit.probe}`,
        remediation: "rewrite the description to remove the flagged phrase",
      });
    }
  }

  findings.sort(compareFindings);

  return {
    generatedAt: now().toISOString(),
    agents: config.agents,
    findings,
    usageEvidence,
  };
}
