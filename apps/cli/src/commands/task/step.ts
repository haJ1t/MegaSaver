import {
  type FailedAttempt,
  type StepOutcome,
  failedAttemptSchema,
} from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { taskPlanIdSchema, taskStepIdSchema } from "./shared.js";

export type RunTaskStepInput = {
  planIdFlag: string;
  stepIdFlag: string;
  statusFlag: string;
  outputFlag?: string | undefined;
  errorFlag?: string | undefined;
  recordFailure?: boolean;
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

export async function runTaskStep(input: RunTaskStepInput): Promise<0 | 1> {
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
  if (input.statusFlag !== "running" && input.statusFlag !== "completed" && input.statusFlag !== "failed") {
    input.stderr(`error: invalid status "${input.statusFlag}" (running | completed | failed)`);
    return 1;
  }
  const status = input.statusFlag;
  const outcome: StepOutcome =
    status === "running"
      ? { status: "running" }
      : status === "completed"
        ? { status: "completed", ...(input.outputFlag !== undefined ? { output: input.outputFlag } : {}) }
        : { status: "failed", ...(input.errorFlag !== undefined ? { error: input.errorFlag } : {}) };

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const now = input.now ?? (() => new Date().toISOString());
    const ts = () => readTestEnv("MEGA_TEST_NOW") ?? now();
    const plan = registry.recordTaskStep(planId, stepId, outcome, { now: ts });

    if (status === "failed" && input.recordFailure === true) {
      const newId = input.newId ?? (() => crypto.randomUUID());
      const step = plan.steps.find((s) => s.id === stepId);
      const attempt: FailedAttempt = failedAttemptSchema.parse({
        id: readTestEnv("MEGA_TEST_FAILED_ATTEMPT_ID") ?? newId(),
        projectId: plan.projectId,
        sessionId: plan.sessionId,
        task: plan.task,
        failedStep: step?.title ?? "task step",
        relatedFiles: [],
        convertedToRule: false,
        createdAt: ts(),
        ...(input.errorFlag !== undefined ? { errorOutput: input.errorFlag } : {}),
      });
      registry.createFailedAttempt(attempt);
    }

    input.stdout(input.json ? JSON.stringify(plan) : `plan ${plan.status}; step ${stepId} ${status}`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const taskStepCommand = defineCommand({
  meta: { name: "step", description: "Report a step running/completed/failed." },
  args: {
    planId: { type: "positional", required: true, description: "Task plan id (UUID)." },
    stepId: { type: "positional", required: true, description: "Task step id (UUID)." },
    status: { type: "string", required: true, description: "running | completed | failed." },
    output: { type: "string", description: "Step output (with --status completed)." },
    error: { type: "string", description: "Step error (with --status failed)." },
    "record-failure": {
      type: "boolean",
      default: false,
      description: "Also record a FailedAttempt (only with --status failed).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runTaskStep({
      planIdFlag: typeof args.planId === "string" ? args.planId : "",
      stepIdFlag: typeof args.stepId === "string" ? args.stepId : "",
      statusFlag: typeof args.status === "string" ? args.status : "",
      outputFlag: typeof args.output === "string" ? args.output : undefined,
      errorFlag: typeof args.error === "string" ? args.error : undefined,
      recordFailure: !!args["record-failure"],
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
