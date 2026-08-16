import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { type KnownAgentId, knownAgentIdSchema } from "../setup/agent-ids.js";
import { detectAgent } from "../setup/detect-agent.js";
import type { McpAgentConfigSurface, McpSecurityFinding } from "./report.js";

const mcpServerEntrySchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    env: z.record(z.string()).optional(),
  })
  .passthrough();

const mcpConfigSchema = z
  .object({
    mcpServers: z.record(mcpServerEntrySchema).default({}),
  })
  .passthrough();

export type ConfiguredServer = {
  agentId: KnownAgentId;
  serverKey: string;
  isMegaBridge: boolean;
};

export type ConfigSurfaceResult = {
  agents: McpAgentConfigSurface[];
  servers: ConfiguredServer[];
  findings: McpSecurityFinding[];
};

function isLoopbackHostname(hostname: string): boolean {
  let lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    lower = lower.slice(1, -1);
  }
  if (
    lower === "localhost" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "0:0:0:0:0:0:0:1"
  )
    return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower.startsWith("127.")) {
    const parts = lower.split(".");
    if (parts.length === 4 && parts[0] === "127") {
      let allNumeric = true;
      for (let i = 1; i < 4; i++) {
        const p = parts[i];
        if (p === undefined || p.length === 0) {
          allNumeric = false;
          break;
        }
        for (const ch of p) {
          if (ch < "0" || ch > "9") {
            allNumeric = false;
            break;
          }
        }
        if (!allNumeric) break;
      }
      if (allNumeric) return true;
    }
    return false;
  }
  return false;
}

export function nonLocalhostOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isLoopbackHostname(url.hostname)) return null;
  return url.origin;
}

function extractUrlCandidates(entry: {
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}): { raw: string; envKey?: string }[] {
  const candidates: { raw: string; envKey?: string }[] = [];
  if (entry.command !== undefined) {
    const httpIdx = entry.command.indexOf("http://");
    const httpsIdx = entry.command.indexOf("https://");
    let idx = -1;
    if (httpIdx !== -1 && httpsIdx !== -1) idx = Math.min(httpIdx, httpsIdx);
    else if (httpIdx !== -1) idx = httpIdx;
    else if (httpsIdx !== -1) idx = httpsIdx;
    if (idx !== -1) {
      const slice = entry.command.slice(idx);
      let end = -1;
      for (let k = 0; k < slice.length; k++) {
        const ch = slice[k];
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
          end = k;
          break;
        }
      }
      candidates.push({ raw: end === -1 ? slice : slice.slice(0, end) });
    }
  }
  if (entry.url !== undefined) {
    candidates.push({ raw: entry.url });
  }
  for (const arg of entry.args ?? []) {
    const httpIdx = arg.indexOf("http://");
    const httpsIdx = arg.indexOf("https://");
    let idx = -1;
    if (httpIdx !== -1 && httpsIdx !== -1) idx = Math.min(httpIdx, httpsIdx);
    else if (httpIdx !== -1) idx = httpIdx;
    else if (httpsIdx !== -1) idx = httpsIdx;
    if (idx === -1) continue;
    const slice = arg.slice(idx);
    let end = -1;
    for (let k = 0; k < slice.length; k++) {
      const ch = slice[k];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        end = k;
        break;
      }
    }
    candidates.push({ raw: end === -1 ? slice : slice.slice(0, end) });
  }
  for (const [key, value] of Object.entries(entry.env ?? {})) {
    const httpIdx = value.indexOf("http://");
    const httpsIdx = value.indexOf("https://");
    let idx = -1;
    if (httpIdx !== -1 && httpsIdx !== -1) idx = Math.min(httpIdx, httpsIdx);
    else if (httpIdx !== -1) idx = httpIdx;
    else if (httpsIdx !== -1) idx = httpsIdx;
    if (idx === -1) continue;
    const slice = value.slice(idx);
    let end = -1;
    for (let k = 0; k < slice.length; k++) {
      const ch = slice[k];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        end = k;
        break;
      }
    }
    candidates.push({ raw: end === -1 ? slice : slice.slice(0, end), envKey: key });
  }
  return candidates;
}

export async function readConfigSurface(input: {
  home: string;
  platform: NodeJS.Platform;
}): Promise<ConfigSurfaceResult> {
  const agents: McpAgentConfigSurface[] = [];
  const servers: ConfiguredServer[] = [];
  const findings: McpSecurityFinding[] = [];

  if (input.platform === "win32") {
    findings.push({
      checkId: "config_surface",
      code: "evidence_gap",
      severity: "info",
      message: "config permission bits not meaningful on win32 — unknown",
      remediation: "verify file ACLs manually on Windows (icacls)",
    });
  }

  for (const agentId of knownAgentIdSchema.options) {
    const { configPath } = detectAgent({ agentId, home: input.home });
    let raw: string;
    try {
      raw = await readFile(configPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        agents.push({ agentId, configPath, present: false, serverKeys: [] });
        continue;
      }
      findings.push({
        checkId: "config_surface",
        code: "config_unreadable",
        severity: "medium",
        agentId,
        message: `cannot read ${configPath}: ${(err as Error).message}`,
        remediation: "ensure the file is valid JSON and readable (chmod 600)",
      });
      agents.push({ agentId, configPath, present: false, serverKeys: [] });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      findings.push({
        checkId: "config_surface",
        code: "config_unreadable",
        severity: "medium",
        agentId,
        message: `malformed JSON in ${configPath}`,
        remediation: "ensure the file is valid JSON and readable (chmod 600)",
      });
      agents.push({ agentId, configPath, present: true, serverKeys: [] });
      continue;
    }

    const result = mcpConfigSchema.safeParse(parsed);
    if (!result.success) {
      findings.push({
        checkId: "config_surface",
        code: "config_unreadable",
        severity: "medium",
        agentId,
        message: `malformed JSON in ${configPath}: ${result.error.message}`,
        remediation: "ensure the file is valid JSON and readable (chmod 600)",
      });
      agents.push({ agentId, configPath, present: true, serverKeys: [] });
      continue;
    }

    const serverKeys = Object.keys(result.data.mcpServers);
    agents.push({ agentId, configPath, present: true, serverKeys });

    for (const [serverKey, entry] of Object.entries(result.data.mcpServers)) {
      servers.push({ agentId, serverKey, isMegaBridge: serverKey === "megasaver" });
      for (const candidate of extractUrlCandidates(
        entry as { url?: string; args?: string[]; env?: Record<string, string> },
      )) {
        const origin = nonLocalhostOrigin(candidate.raw);
        if (origin === null) continue;
        findings.push({
          checkId: "config_surface",
          code: "non_localhost_url",
          severity: "medium",
          agentId,
          serverKey,
          message:
            candidate.envKey !== undefined
              ? `env ${candidate.envKey} references ${origin}`
              : `${origin}`,
          remediation: "verify the URL is intended; prefer localhost or remove the remote endpoint",
        });
      }
    }

    if (input.platform !== "win32") {
      try {
        const st = await stat(configPath);
        const mode = st.mode;
        if ((mode & 0o002) !== 0) {
          findings.push({
            checkId: "config_surface",
            code: "config_world_writable",
            severity: "critical",
            agentId,
            message: `${configPath} is world-writable`,
            remediation: `chmod 600 ${configPath}`,
          });
        } else if ((mode & 0o020) !== 0) {
          findings.push({
            checkId: "config_surface",
            code: "config_group_writable",
            severity: "medium",
            agentId,
            message: `${configPath} is group-writable`,
            remediation: `chmod 600 ${configPath}`,
          });
        }
      } catch {
        // stat failure is not a finding — file was already read
      }
    }
  }

  return { agents, servers, findings };
}
