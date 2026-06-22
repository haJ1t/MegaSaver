import { listAgents, listAudit, listTasks, loadAgent } from "@megasaver/agent-office";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import type { RoleStoreEnvInput } from "./role.js";

export type RunOfficeStatusInput = RoleStoreEnvInput & {
  agentId?: string;
  json?: boolean;
};

export async function runOfficeStatus(input: RunOfficeStatusInput): Promise<0 | 1> {
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

    let agents: Awaited<ReturnType<typeof listAgents>>;
    if (input.agentId !== undefined) {
      const single = await loadAgent({
        storeRoot: rootDir,
        workspaceKey: wk,
        officeAgentId: input.agentId,
      });
      agents = [single];
    } else {
      agents = await listAgents({ storeRoot: rootDir, workspaceKey: wk });
    }

    const allAudit = await listAudit({ storeRoot: rootDir, workspaceKey: wk });

    const rows = await Promise.all(
      agents.map(async (agent) => {
        const tasks = await listTasks({
          storeRoot: rootDir,
          workspaceKey: wk,
          officeAgentId: agent.id,
        });
        const running = tasks.find((t) => t.status === "running");
        const earliestQueued = tasks
          .filter((t) => t.status === "queued")
          .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
        const currentTask = running ?? earliestQueued ?? null;
        const agentAudit = allAudit.filter((e) => e.officeAgentId === agent.id);
        const lastEvent =
          agentAudit.length > 0 ? (agentAudit[agentAudit.length - 1] ?? null) : null;
        return { agent, currentTask, lastEvent };
      }),
    );

    if (input.json) {
      input.stdout(JSON.stringify({ agents: rows }));
    } else {
      for (const { agent, currentTask, lastEvent } of rows) {
        const taskStr = currentTask ? `task=${currentTask.id}(${currentTask.status})` : "no-task";
        const eventStr = lastEvent ? `last=${lastEvent.type}` : "no-audit";
        input.stdout(`${agent.id}  ${agent.name}  ${agent.status}  ${taskStr}  ${eventStr}`);
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeStatusCommand = defineCommand({
  meta: { name: "status", description: "Show agent status (all or one)." },
  args: {
    agentId: { type: "positional", required: false, description: "Agent id (optional)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const agentIdStr = typeof args.agentId === "string" ? args.agentId : undefined;
    const code = await runOfficeStatus({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(agentIdStr !== undefined ? { agentId: agentIdStr } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
