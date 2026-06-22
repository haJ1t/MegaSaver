import { officeTaskSchema, saveTask } from "@megasaver/agent-office";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import type { RoleStoreEnvInput } from "./role.js";

export type RunOfficeAssignInput = RoleStoreEnvInput & {
  agentId: string;
  instruction: string;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runOfficeAssign(input: RunOfficeAssignInput): Promise<0 | 1> {
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

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_OFFICE_TASK_ID") ?? newId();
    const queuedAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    const task = officeTaskSchema.parse({
      id,
      agentId: input.agentId,
      workspaceKey: wk,
      instruction: input.instruction,
      status: "queued",
      queuedAt,
    });

    await saveTask({ storeRoot: rootDir, task });
    input.stdout(input.json ? JSON.stringify(task) : task.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_task" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeAssignCommand = defineCommand({
  meta: { name: "assign", description: "Assign a task to an agent." },
  args: {
    agentId: { type: "positional", required: true, description: "Agent id." },
    instruction: { type: "positional", required: true, description: "Task instruction." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeAssign({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      agentId: typeof args.agentId === "string" ? args.agentId : "",
      instruction: typeof args.instruction === "string" ? args.instruction : "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
