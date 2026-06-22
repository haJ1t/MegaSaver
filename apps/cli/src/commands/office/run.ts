import {
  OFFICE_PROJECT_ID,
  createLauncherRegistry,
  createSupervisor,
  ensureOfficeProject,
  loadAgent,
} from "@megasaver/agent-office";
import type { LauncherRegistry } from "@megasaver/agent-office";
import { createClaudeCodeLauncher } from "@megasaver/connector-claude-code";
import type { CoreRegistry } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import type { RoleStoreEnvInput } from "./role.js";

// MEGA_OFFICE_ALLOW_FULL env var is the CLI-level toggle (env-var name kept in sync with spec).
function readEnv(name: string): string | undefined {
  const val = process.env[name];
  return typeof val === "string" ? val : undefined;
}

export type RunOfficeRunInput = RoleStoreEnvInput & {
  agentId: string;
  allowFull?: boolean;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
  // Injection for tests — defaults to real launchers + ensureStoreReady registry in production.
  registry?: LauncherRegistry;
  coreRegistry?: CoreRegistry;
};

export async function runOfficeRun(input: RunOfficeRunInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const allowFull = input.allowFull === true || readEnv("MEGA_OFFICE_ALLOW_FULL") === "1";
  const wk = encodeWorkspaceKey(input.cwd);

  try {
    let coreRegistry: CoreRegistry;
    if (input.coreRegistry !== undefined) {
      coreRegistry = input.coreRegistry;
    } else {
      const { registry: storeRegistry, initialized } = await ensureStoreReady(rootDir);
      if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
      coreRegistry = storeRegistry;
    }

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());

    // Load the agent first: an unknown agent is the missing thing here (run
    // loads/drains the agent), so map not_found → "agent not found". Also gives
    // us the status for the no-op note below.
    let agentStatus: string;
    try {
      const agent = await loadAgent({
        storeRoot: rootDir,
        workspaceKey: wk,
        officeAgentId: input.agentId,
      });
      agentStatus = agent.status;
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
      input.stderr(cli.message);
      return cli.exitCode;
    }

    ensureOfficeProject(coreRegistry, now);

    const registry = input.registry ?? createLauncherRegistry([createClaudeCodeLauncher()]);

    const supervisor = createSupervisor({
      storeRoot: rootDir,
      registry,
      coreRegistry,
      projectId: OFFICE_PROJECT_ID,
      now,
      newId,
      allowFull,
    });

    const tasks = await supervisor.drainAgent(wk, input.agentId);

    // drainAgent returns [] when the agent is paused/stopped/error or has no
    // queued task. Surface a one-line note so the no-op is not silent.
    if (tasks.length === 0) {
      input.stderr(`note: no tasks drained for ${input.agentId} (status=${agentStatus})`);
    }

    const anyFailed = tasks.some((t) => t.status === "failed");

    if (input.json) {
      input.stdout(
        JSON.stringify(
          tasks.map((t) => ({ id: t.id, status: t.status, exitCode: t.exitCode ?? null })),
        ),
      );
    } else {
      for (const t of tasks) {
        const exitStr = t.exitCode !== undefined ? ` exitCode=${t.exitCode}` : "";
        input.stdout(`${t.id}  ${t.status}${exitStr}`);
      }
    }

    return anyFailed ? 1 : 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "office_agent" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const officeRunCommand = defineCommand({
  meta: { name: "run", description: "Run queued tasks for an agent (drains the queue)." },
  args: {
    agentId: { type: "positional", required: true, description: "Agent id to run." },
    "allow-full": {
      type: "boolean",
      default: false,
      description: "Allow full permission mode (or set MEGA_OFFICE_ALLOW_FULL=1).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOfficeRun({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      agentId: typeof args.agentId === "string" ? args.agentId : "",
      allowFull: !!args["allow-full"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
