import { type McpToolName, mcpToolNameSchema } from "./tool-name.js";

// Public-facing MCP tool naming mode (Proxy Mode v1.2 §5). The bridge
// exposes exactly one name per underlying tool — never both proxy_*
// and mega_* — so a token-saving product never wastes context on
// duplicate tool schemas.
export type NamingMode = "proxy" | "legacy";

const ENV_KEY = "MEGASAVER_TOOL_NAMING";

// Unset/empty/unrecognized fails safe to proxy (the v1.2 default);
// trimmed + case-insensitive. Only "legacy" opts out.
export function resolveNamingMode(raw: string | undefined): NamingMode {
  return (raw ?? "").trim().toLowerCase() === "legacy" ? "legacy" : "proxy";
}

export function namingModeFromEnv(env: NodeJS.ProcessEnv = process.env): NamingMode {
  return resolveNamingMode(env[ENV_KEY]);
}

// §5.3 mapping: internal dispatch id (== legacy wire name) -> proxy
// wire name. Only these three tools are renamed by v1.2. mega_recall
// has no proxy twin in the spec mapping and keeps its name in both
// modes (confirm in repo before extending the map).
const NAME_PAIRS: ReadonlyArray<readonly [McpToolName, string]> = [
  ["mega_read_file", "proxy_read_file"],
  ["mega_run_command", "proxy_run_command"],
  ["mega_fetch_chunk", "proxy_expand_chunk"],
];

const PROXY_BY_LEGACY = new Map<McpToolName, string>(NAME_PAIRS);
const LEGACY_BY_PROXY = new Map<string, McpToolName>(
  NAME_PAIRS.map(([legacy, proxy]) => [proxy, legacy]),
);

export function exposedToolName(id: McpToolName, mode: NamingMode): string {
  if (mode === "legacy") return id;
  return PROXY_BY_LEGACY.get(id) ?? id;
}

// Resolve an incoming wire name (mode-dependent) back to the internal
// dispatch id, or undefined if the name is not exposed in this mode.
export function internalIdFromExposed(name: string, mode: NamingMode): McpToolName | undefined {
  if (mode === "legacy") {
    const parsed = mcpToolNameSchema.safeParse(name);
    return parsed.success ? parsed.data : undefined;
  }
  const mapped = LEGACY_BY_PROXY.get(name);
  if (mapped !== undefined) return mapped;
  // In proxy mode a renamed legacy name (mega_read_file, …) is no
  // longer exposed; only unmapped legacy names (mega_recall) remain.
  const parsed = mcpToolNameSchema.safeParse(name);
  if (parsed.success && !PROXY_BY_LEGACY.has(parsed.data)) return parsed.data;
  return undefined;
}
