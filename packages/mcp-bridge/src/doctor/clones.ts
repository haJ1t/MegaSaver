import { mcpToolNameSchema } from "../tool-name.js";
import { type NamingMode, exposedToolName } from "../tool-naming.js";
import type { McpSecurityFinding } from "./report.js";

export type NamedTool = { serverKey: string; toolName: string };

let cachedExposed: ReadonlySet<string> | null = null;

export function bridgeExposedNames(): ReadonlySet<string> {
  if (cachedExposed !== null) return cachedExposed;
  const names = new Set<string>();
  for (const id of mcpToolNameSchema.options) {
    for (const mode of ["proxy", "legacy"] as const satisfies NamingMode[]) {
      names.add(exposedToolName(id, mode));
    }
  }
  cachedExposed = names;
  return names;
}

export function normalizeToolName(name: string): string {
  let out = "";
  for (const ch of name.toLowerCase()) if (ch !== "-" && ch !== "_") out += ch;
  return out;
}

export function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return false;
  const lenA = a.length;
  const lenB = b.length;
  const diff = Math.abs(lenA - lenB);
  if (diff > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < lenA && j < lenB) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (edits === 1) return false;
      edits++;
      if (lenA > lenB) i++;
      else if (lenB > lenA) j++;
      else {
        i++;
        j++;
      }
    }
  }
  if (i < lenA || j < lenB) edits++;
  return edits === 1;
}

export function detectClones(tools: readonly NamedTool[]): McpSecurityFinding[] {
  const findings: McpSecurityFinding[] = [];
  const bridgeNames = bridgeExposedNames();

  // Group by bare name
  const byBare = new Map<string, NamedTool[]>();
  for (const tool of tools) {
    const list = byBare.get(tool.toolName);
    if (list === undefined) byBare.set(tool.toolName, [tool]);
    else list.push(tool);
  }
  for (const [bare, group] of byBare) {
    const servers = new Set(group.map((t) => t.serverKey));
    if (servers.size >= 2) {
      findings.push({
        checkId: "clone_shadowing",
        code: "clone_exact",
        severity: "high",
        message: `tool "${bare}" exposed by ${servers.size} servers: ${[...servers].sort().join(", ")}`,
        remediation: "rename one server's tool or remove the duplicate server",
      });
    }
  }

  // Shadow check: any third-party tool whose name (raw or normalized) matches a bridge name
  for (const tool of tools) {
    if (tool.serverKey.toLowerCase() === "megasaver") continue;
    const rawMatch = bridgeNames.has(tool.toolName);
    const normMatch = [...bridgeNames].some(
      (b) => normalizeToolName(b) === normalizeToolName(tool.toolName),
    );
    if (rawMatch || normMatch) {
      findings.push({
        checkId: "clone_shadowing",
        code: "shadows_bridge_tool",
        severity: "high",
        serverKey: tool.serverKey,
        toolName: tool.toolName,
        message: `"${tool.toolName}" on "${tool.serverKey}" shadows a bridge tool`,
        remediation: "rename the shadowing tool or isolate the server",
      });
    }
  }

  // Near-duplicate: pairwise over distinct names; inventory is sampled at 500 to bound work,
  // but detection still runs on the sample so an attacker cannot suppress clone_near by flooding.
  let distinctNames = [...new Set(tools.map((t) => t.toolName))];
  const truncated = distinctNames.length > 500;
  if (truncated) {
    findings.push({
      checkId: "clone_shadowing",
      code: "inventory_truncated",
      severity: "info",
      message: `tool inventory truncated at 500 distinct names (${distinctNames.length} observed)`,
      remediation: "review truncated inventory manually",
    });
    distinctNames = distinctNames.slice(0, 500);
  }
  // Map distinct names to the set of serverKeys that expose them (for cross-server gate).
  const serversByName = new Map<string, Set<string>>();
  for (const tool of tools) {
    const set = serversByName.get(tool.toolName);
    if (set === undefined) serversByName.set(tool.toolName, new Set([tool.serverKey]));
    else set.add(tool.serverKey);
  }
  const seen = new Set<string>();
  for (let i = 0; i < distinctNames.length; i++) {
    const a = distinctNames[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < distinctNames.length; j++) {
      const b = distinctNames[j];
      if (b === undefined) continue;
      const serversA = serversByName.get(a);
      const serversB = serversByName.get(b);
      const crossServer =
        serversA !== undefined &&
        serversB !== undefined &&
        ![...serversA].some((s) => serversB.has(s));
      // clone_near is cross-server only (spec § clone_shadowing: "across servers")
      if (!crossServer) continue;
      const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normA = normalizeToolName(a);
      const normB = normalizeToolName(b);
      const isNear =
        normA === normB || editDistanceAtMostOne(a, b) || editDistanceAtMostOne(normA, normB);
      if (isNear) {
        findings.push({
          checkId: "clone_shadowing",
          code: "clone_near",
          severity: "medium",
          message: `"${a}" near-duplicate of "${b}"`,
          remediation: "disambiguate tool names to avoid confused-deputy calls",
        });
      }
    }
  }

  return findings;
}
