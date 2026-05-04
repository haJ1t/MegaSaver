import type { ProjectId } from "@megasaver/shared";
import { CoreRegistryError } from "./errors.js";
import { type Project, projectSchema } from "./project.js";

export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
}

export function createInMemoryCoreRegistry(): CoreRegistry {
  const projects = new Map<ProjectId, Project>();

  return {
    createProject(project) {
      const parsed = projectSchema.parse(project);
      if (projects.has(parsed.id)) {
        throw new CoreRegistryError(
          "project_already_exists",
          `Project already exists: ${parsed.id}`,
        );
      }

      projects.set(parsed.id, parsed);
      return projectSchema.parse(parsed);
    },

    getProject(id) {
      const project = projects.get(id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return Array.from(projects.values(), (project) =>
        projectSchema.parse(project),
      );
    },
  };
}
