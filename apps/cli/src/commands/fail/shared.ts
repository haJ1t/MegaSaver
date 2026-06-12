import type { FailedAttempt } from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";

export { failedAttemptIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatFailureLine(
  f: Pick<FailedAttempt, "id" | "task" | "convertedToRule">,
): string {
  return `${f.id}  ${f.convertedToRule ? "[converted]" : "[open]     "}  ${f.task}`;
}

export function formatFailureShow(f: FailedAttempt): string[] {
  return [
    `id          ${f.id}`,
    `project     ${f.projectId}`,
    `task        ${f.task}`,
    `failedStep  ${f.failedStep}`,
    `error       ${f.errorOutput ?? "-"}`,
    `cause       ${f.suspectedCause ?? "-"}`,
    `resolution  ${f.resolution ?? "-"}`,
    `files       ${f.relatedFiles.length > 0 ? f.relatedFiles.join(", ") : "-"}`,
    `converted   ${f.convertedToRule}`,
    `createdAt   ${f.createdAt}`,
  ];
}
