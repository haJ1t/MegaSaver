import { readySteps } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { taskPlanIdSchema } from "./shared.js";

export type RunTaskExplainInput = {
  planIdFlag: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runTaskExplain(input: RunTaskExplainInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
  } catch {
    input.stderr(`error: invalid task plan id "${input.planIdFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const plan = registry.getTaskPlan(planId);
    if (!plan) {
      input.stderr("error: task plan not found");
      return 1;
    }
    const ready = new Set(readySteps(plan.steps));
    const lines: string[] = [`task: ${plan.task} [${plan.status}]`];
    for (const step of plan.steps) {
      let note: string;
      if (step.status !== "pending") {
        note = step.status;
      } else if (ready.has(step.id)) {
        note = "ready";
      } else {
        const blocker = step.dependsOn.find(
          (dep) => plan.steps.find((s) => s.id === dep)?.status !== "completed",
        );
        const blockerStatus = plan.steps.find((s) => s.id === blocker)?.status ?? "unknown";
        note = `blocked: waiting on ${blocker} (${blockerStatus})`;
      }
      lines.push(`  ${step.type}  ${step.title}  [${step.id}]  -> ${note}`);
    }
    lines.push("retry rule: retrying a failed step resets only it and its dependents.");
    if (input.json) input.stdout(JSON.stringify({ plan, ready: [...ready] }));
    else for (const line of lines) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskExplainCommand = defineCommand({
  meta: { name: "explain", description: "Explain a task plan: per-step state and blocked reasons." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskExplain({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
