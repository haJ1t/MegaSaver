import { defineCommand } from "citty";
import { taskExplainCommand } from "./explain.js";
import { taskPlanCommand } from "./plan.js";
import { taskRetryCommand } from "./retry.js";
import { taskStatusCommand } from "./status.js";
import { taskStepCommand } from "./step.js";

export { type RunTaskPlanInput, runTaskPlan, taskPlanCommand } from "./plan.js";
export { type RunTaskStepInput, runTaskStep, taskStepCommand } from "./step.js";
export { type RunTaskRetryInput, runTaskRetry, taskRetryCommand } from "./retry.js";
export { type RunTaskStatusInput, runTaskStatus, taskStatusCommand } from "./status.js";
export { type RunTaskExplainInput, runTaskExplain, taskExplainCommand } from "./explain.js";

export const taskCommand = defineCommand({
  meta: { name: "task", description: "Decompose a task into a tracked, retryable plan." },
  subCommands: {
    plan: taskPlanCommand,
    status: taskStatusCommand,
    step: taskStepCommand,
    retry: taskRetryCommand,
    explain: taskExplainCommand,
  },
});
