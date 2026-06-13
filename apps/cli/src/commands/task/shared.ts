import type { TaskPlan, TaskStep } from "@megasaver/core";
import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";

export { taskPlanIdSchema, taskStepIdSchema };

// Parse repeatable `--step "type:title"` flags into create-input steps with a
// linear dependency chain (step N dependsOn step N-1). A dependency-rich plan
// uses the MCP build_task_plan tool or a future --steps-json flag.
export function parseStepFlags(value: unknown): {
  type: string;
  title: string;
  key: string;
  dependsOnKeys: string[];
}[] {
  const raw = toStringArray(value);
  return raw.map((entry, i) => {
    const sep = entry.indexOf(":");
    const type = sep === -1 ? entry : entry.slice(0, sep);
    const title = sep === -1 ? entry : entry.slice(sep + 1);
    return {
      type: type.trim(),
      title: title.trim(),
      key: `s${i}`,
      dependsOnKeys: i === 0 ? [] : [`s${i - 1}`],
    };
  });
}

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatStepLine(s: Pick<TaskStep, "id" | "status" | "type" | "title">): string {
  return `${s.id}  ${s.status.padEnd(9, " ")}  ${s.type.padEnd(16, " ")}  ${s.title}`;
}

export function formatPlanStatus(plan: TaskPlan, ready: readonly string[]): string[] {
  return [
    `plan    ${plan.id}`,
    `task    ${plan.task}`,
    `status  ${plan.status}`,
    ...plan.steps.map(formatStepLine),
    `ready   ${ready.length > 0 ? ready.join(", ") : "-"}`,
  ];
}
