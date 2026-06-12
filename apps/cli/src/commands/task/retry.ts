import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { taskPlanIdSchema, taskStepIdSchema } from "./shared.js";

export type RunTaskRetryInput = {
  planIdFlag: string;
  stepIdFlag: string;
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

export async function runTaskRetry(input: RunTaskRetryInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let planId: ReturnType<typeof taskPlanIdSchema.parse>;
  let stepId: ReturnType<typeof taskStepIdSchema.parse>;
  try {
    planId = taskPlanIdSchema.parse(input.planIdFlag);
    stepId = taskStepIdSchema.parse(input.stepIdFlag);
  } catch {
    input.stderr("error: invalid plan or step id");
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const before = registry.getTaskPlan(planId);
    const plan = registry.retryTaskStep(planId, stepId);
    // Report which steps changed to pending (the reset set).
    const reset = plan.steps
      .filter(
        (s) =>
          s.status === "pending" && before?.steps.find((b) => b.id === s.id)?.status !== "pending",
      )
      .map((s) => s.id);
    if (input.json) {
      input.stdout(JSON.stringify({ planStatus: plan.status, reset }));
    } else {
      input.stdout(`plan ${plan.status}; reset ${reset.length > 0 ? reset.join(", ") : "-"}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskRetryCommand = defineCommand({
  meta: { name: "retry", description: "Selectively retry a failed step (resets it + dependents)." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    stepId: { type: "positional", required: true, description: "Failed task step id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskRetry({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      stepIdFlag: typeof args.stepId === "string" ? args.stepId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
