import { loadAgent, officeAgentSchema, saveAgent } from "@megasaver/agent-office";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import type { RoleStoreEnvInput } from "./role.js";

export type ControlAction = "pause" | "resume" | "stop";

export type RunOfficeControlInput = RoleStoreEnvInput & {
  agentId: string;
  action: ControlAction;
  json?: boolean;
};

export async function runOfficeControl(input: RunOfficeControlInput): Promise<0 | 1> {
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

    const agent = await loadAgent({
      storeRoot: rootDir,
      workspaceKey: wk,
      officeAgentId: input.agentId,
    });
    const nextStatus =
      input.action === "pause" ? "paused" : input.action === "resume" ? "idle" : "stopped";
    const updated = officeAgentSchema.parse({ ...agent, status: nextStatus });
    await saveAgent({ storeRoot: rootDir, agent: updated });

    input.stdout(input.json ? JSON.stringify(updated) : `${updated.id}  ${updated.status}`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

function makeControlCommand(action: ControlAction) {
  return defineCommand({
    meta: {
      name: action,
      description: `${action.charAt(0).toUpperCase() + action.slice(1)} an agent.`,
    },
    args: {
      agentId: { type: "positional", required: true, description: "Agent id." },
      store: { type: "string", description: "Override store directory." },
      json: { type: "boolean", default: false, description: "Emit JSON output." },
    },
    async run({ args }) {
      const code = await runOfficeControl({
        ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
        agentId: typeof args.agentId === "string" ? args.agentId : "",
        action,
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
        json: !!args.json,
      });
      if (code !== 0) process.exitCode = code;
    },
  });
}

export const officePauseCommand = makeControlCommand("pause");
export const officeResumeCommand = makeControlCommand("resume");
export const officeStopCommand = makeControlCommand("stop");
