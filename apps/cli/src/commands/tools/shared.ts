import type { ToolDefinition } from "@megasaver/core";
import { toolDefinitionIdSchema } from "@megasaver/shared";

export { toolDefinitionIdSchema };

export function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export function formatToolLine(
  t: Pick<ToolDefinition, "id" | "risk" | "category" | "name">,
): string {
  return `${t.id}  ${t.risk.padEnd(9, " ")}  ${t.category.padEnd(10, " ")}  ${t.name}`;
}
