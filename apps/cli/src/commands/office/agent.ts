import {
  deleteAgent,
  listAgents,
  loadRole,
  officeAgentSchema,
  saveAgent,
} from "@megasaver/agent-office";
import { encodeWorkspaceKey, titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import type { RoleStoreEnvInput } from "./role.js";

// ─── agent list ──────────────────────────────────────────────────────────────

export type RunOfficeAgentListInput = RoleStoreEnvInput & {
  json?: boolean;
};

export async function runOfficeAgentList(input: RunOfficeAgentListInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const wk = encodeWorkspaceKey(input.cwd);

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry;
    const agents = await listAgents({ storeRoot: rootDir, workspaceKey: wk });
    if (input.json) {
      input.stdout(JSON.stringify(agents));
    } else {
      for (const a of agents) {
        input.stdout(`${a.id}  ${a.name}  ${a.kind}  ${a.status}  ${a.workdir}`);
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeAgentListCommand = defineCommand({
  meta: { name: "list", description: "List agents for current workspace." },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeAgentList({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── agent create ─────────────────────────────────────────────────────────────

export type RunOfficeAgentCreateInput = RoleStoreEnvInput & {
  nameFlag: string;
  roleIdFlag: string;
  workdirFlag: string;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runOfficeAgentCreate(input: RunOfficeAgentCreateInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Validate name
  const nameResult = titleSchema.safeParse(input.nameFlag);
  if (!nameResult.success) {
    const cli = mapErrorToCliMessage(nameResult.error, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const wk = encodeWorkspaceKey(input.cwd);

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry;

    // Load role to derive kind
    const role = await loadRole({ storeRoot: rootDir, roleId: input.roleIdFlag });

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_OFFICE_AGENT_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    const agent = officeAgentSchema.parse({
      id,
      name: nameResult.data,
      roleId: role.id,
      kind: role.kind,
      workspaceKey: wk,
      workdir: input.workdirFlag,
      status: "idle",
      createdAt,
    });

    await saveAgent({ storeRoot: rootDir, agent });
    input.stdout(input.json ? JSON.stringify(agent) : agent.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeAgentCreateCommand = defineCommand({
  meta: { name: "create", description: "Create an agent in the current workspace." },
  args: {
    name: { type: "string", required: true, description: "Agent name." },
    role: { type: "string", required: true, description: "Role id." },
    workdir: { type: "string", required: true, description: "Working directory for this agent." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeAgentCreate({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      nameFlag: typeof args.name === "string" ? args.name : "",
      roleIdFlag: typeof args.role === "string" ? args.role : "",
      workdirFlag: typeof args.workdir === "string" ? args.workdir : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── agent rm ─────────────────────────────────────────────────────────────────

export type RunOfficeAgentRmInput = RoleStoreEnvInput & {
  agentId: string;
};

export async function runOfficeAgentRm(input: RunOfficeAgentRmInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const wk = encodeWorkspaceKey(input.cwd);

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    void registry;
    await deleteAgent({ storeRoot: rootDir, workspaceKey: wk, officeAgentId: input.agentId });
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeAgentRmCommand = defineCommand({
  meta: { name: "rm", description: "Delete an agent." },
  args: {
    agentId: { type: "positional", required: true, description: "Agent id to delete." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runOfficeAgentRm({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      agentId: typeof args.agentId === "string" ? args.agentId : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

// ─── agent command group ──────────────────────────────────────────────────────

export const officeAgentCommand = defineCommand({
  meta: { name: "agent", description: "Manage office agents." },
  subCommands: {
    list: officeAgentListCommand,
    create: officeAgentCreateCommand,
    rm: officeAgentRmCommand,
  },
});
