import type { Project } from "@megasaver/core";

export function formatProjectLine(project: Pick<Project, "id" | "name">): string {
  return `${project.id}  ${project.name}`;
}
