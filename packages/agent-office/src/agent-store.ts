import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type OfficeAgent, officeAgentSchema } from "./agent.js";
import { atomicWriteFile } from "./atomic-write.js";
import { AgentOfficeError } from "./errors.js";
import { agentPath, agentsDir } from "./paths.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseAgentFile(path: string, raw: string): OfficeAgent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt agent file: ${path}`, { cause: error });
  }
  try {
    return officeAgentSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt agent file: ${path}`, { cause: error });
  }
}

export async function saveAgent(input: { storeRoot: string; agent: OfficeAgent }): Promise<void> {
  let agent: OfficeAgent;
  try {
    agent = officeAgentSchema.parse(input.agent);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Agent is invalid.", { cause: error });
  }
  const path = agentPath({
    storeRoot: input.storeRoot,
    workspaceKey: agent.workspaceKey,
    officeAgentId: agent.id,
  });
  atomicWriteFile(path, `${JSON.stringify(agent, null, 2)}\n`);
}

export async function loadAgent(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<OfficeAgent> {
  const path = agentPath(input);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      throw new AgentOfficeError("not_found", `Agent not found: ${input.officeAgentId}`);
    }
    throw error;
  }
  return parseAgentFile(path, raw);
}

export async function listAgents(input: {
  storeRoot: string;
  workspaceKey: string;
}): Promise<readonly OfficeAgent[]> {
  const dir = agentsDir(input.storeRoot, input.workspaceKey);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const agents: OfficeAgent[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    agents.push(parseAgentFile(path, readFileSync(path, "utf8")));
  }
  return agents;
}

export async function deleteAgent(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): Promise<void> {
  const path = agentPath(input);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    throw new AgentOfficeError("write_failed", `Delete failed: ${input.officeAgentId}`, {
      cause: error,
    });
  }
}
