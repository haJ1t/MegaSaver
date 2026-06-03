import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KnownAgentId } from "./agent-ids.js";
import { detectAgent } from "./detect-agent.js";

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

export async function installMcp(input: {
  agentId: KnownAgentId;
  home: string;
  command: string;
}): Promise<InstallResult> {
  const detected = detectAgent({ agentId: input.agentId, home: input.home });
  const config = await readConfig(detected.configPath);
  const existing = config.mcpServers[detected.serverKey];
  if (existing !== undefined && existing.command === input.command) {
    return { configPath: detected.configPath, changed: false };
  }
  config.mcpServers[detected.serverKey] = { command: input.command };
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
