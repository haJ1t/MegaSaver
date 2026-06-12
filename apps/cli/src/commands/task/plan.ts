import { taskPlanInputSchema } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { parseStepFlags } from "./shared.js";

export type RunTaskPlanInput = {
  projectName: string;
  taskFlag: string;
  stepFlags?: unknown;
  sessionFlag?: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runTaskPlan(input: RunTaskPlanInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const steps = parseStepFlags(input.stepFlags);
  if (steps.length === 0) {
    input.stderr("error: at least one --step is required");
    return 1;
  }
  const planInput = taskPlanInputSchema.safeParse({
    task: input.taskFlag,
    sessionId: null,
    steps,
  });
  if (!planInput.success) {
    input.stderr(`error: invalid plan input: ${planInput.error.message}`);
    return 1;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    // Deterministic test override: a fixed plan id seeds the first mint.
    const fixed = readTestEnv("MEGA_TEST_TASK_PLAN_ID");
    let firstUsed = false;
    const mint = () => {
      if (fixed !== undefined && !firstUsed) {
        firstUsed = true;
        return fixed;
      }
      return newId();
    };
    const plan = registry.createTaskPlan(project.id, planInput.data, {
      now: () => readTestEnv("MEGA_TEST_NOW") ?? now(),
      newId: mint,
    });
    input.stdout(input.json ? JSON.stringify(plan) : plan.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskPlanCommand = defineCommand({
  meta: { name: "plan", description: "Create a task plan from ordered steps." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    task: { type: "string", required: true, description: "The task being decomposed." },
    step: {
      type: "string",
      required: true,
      description: 'Step as "type:title" (repeatable; linear chain by order).',
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskPlan({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : "",
      stepFlags: args.step,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
