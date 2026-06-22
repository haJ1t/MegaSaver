import { listAudit } from "@megasaver/agent-office";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import type { RoleStoreEnvInput } from "./role.js";

export type RunOfficeLogsInput = RoleStoreEnvInput & {
  agentId?: string;
  json?: boolean;
};

export async function runOfficeLogs(input: RunOfficeLogsInput): Promise<0 | 1> {
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

    const allEvents = await listAudit({ storeRoot: rootDir, workspaceKey: wk });
    const events =
      input.agentId !== undefined
        ? allEvents.filter((e) => e.officeAgentId === input.agentId)
        : allEvents;

    if (input.json) {
      input.stdout(JSON.stringify(events));
    } else {
      for (const e of events) {
        input.stdout(`${e.ts}  ${e.type}  agent=${e.officeAgentId}  task=${e.taskId}`);
      }
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeLogsCommand = defineCommand({
  meta: { name: "logs", description: "Show audit log (all or filtered by agent)." },
  args: {
    agentId: { type: "positional", required: false, description: "Agent id (optional)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const agentIdStr = typeof args.agentId === "string" ? args.agentId : undefined;
    const code = await runOfficeLogs({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      ...(agentIdStr !== undefined ? { agentId: agentIdStr } : {}),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
