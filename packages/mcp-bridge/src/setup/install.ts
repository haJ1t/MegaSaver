import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KnownAgentId } from "./agent-ids.js";
import { detectAgent } from "./detect-agent.js";

// Default launch entry: the real `mega` bin + the `mcp serve` subcommand, so
// every written config is actually runnable. (The old "mega-mcp" default named
// a binary that does not exist.) Owned here so both the CLI and the GUI bridge
// reuse one source of truth without apps/gui importing apps/cli.
export const DEFAULT_MCP_COMMAND = "mega";
export const DEFAULT_MCP_ARGS: readonly string[] = ["mcp", "serve"];

export type InstallResult = { configPath: string; changed: boolean };

type McpConfig = { mcpServers: Record<string, { command: string; args?: string[] }> };

async function readConfig(configPath: string): Promise<McpConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<McpConfig>;
    return { mcpServers: parsed.mcpServers ?? {} };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw err;
  }
}

async function writeAtomic(configPath: string, config: McpConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const tmp = join(dirname(configPath), `.${randomUUID()}.tmp`);
  const body = `${JSON.stringify(config, null, 2)}\n`;
  try {
    await writeFile(tmp, body, "utf8");
    await rename(tmp, configPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

function sameArgs(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export async function installMcp(input: {
  agentId: KnownAgentId;
  home: string;
  command: string;
  args?: string[];
}): Promise<InstallResult> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  const config = await readConfig(detected.configPath);
  const existing = config.mcpServers[detected.serverKey];
  // Idempotency compares BOTH command and args: a launch command is
  // unrunnable if either drifts, so a re-install with the same pair
  // is a no-op but any change is re-written.
  if (
    existing !== undefined &&
    existing.command === input.command &&
    sameArgs(existing.args, input.args)
  ) {
    return { configPath: detected.configPath, changed: false };
  }
  const entry: { command: string; args?: string[] } = { command: input.command };
  if (input.args !== undefined) entry.args = input.args;
  config.mcpServers[detected.serverKey] = entry;
  await writeAtomic(detected.configPath, config);
  return { configPath: detected.configPath, changed: true };
}

export async function uninstallMcp(input: {
  agentId: KnownAgentId;
  home: string;
}): Promise<InstallResult> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  const config = await readConfig(detected.configPath);
  if (config.mcpServers[detected.serverKey] === undefined) {
    return { configPath: detected.configPath, changed: false };
  }
  delete config.mcpServers[detected.serverKey];
  await writeAtomic(detected.configPath, config);
  return { configPath: detected.configPath, changed: true };
}

export function isMcpInstalled(input: { agentId: KnownAgentId; home: string }): Promise<boolean> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  return readConfig(detected.configPath).then(
    (c) => c.mcpServers[detected.serverKey] !== undefined,
  );
}
