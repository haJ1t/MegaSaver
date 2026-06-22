import type { CoreRegistry } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";

// Fixed namespaced project id for supervisor-created Core Sessions.
// All office sessions across workspaces share this project — they are
// supervisor-managed and not tied to a user-created project.
// This is the canonical source for this id; consumers (bridge, CLI) import from here.
export const OFFICE_PROJECT_ID = projectIdSchema.parse("00000000-beef-0000-0000-000000000001");

// The office project must exist before any supervisor-created Core Session,
// because CoreRegistry.createSession calls requireProject and throws
// `project_not_found` otherwise. Seed it idempotently. `now` lets callers
// pin a deterministic timestamp.
export function ensureOfficeProject(coreRegistry: CoreRegistry, now: () => string): void {
  if (coreRegistry.getProject(OFFICE_PROJECT_ID) !== null) return;
  const ts = now();
  coreRegistry.createProject({
    id: OFFICE_PROJECT_ID,
    name: "Agent Office",
    rootPath: "office",
    createdAt: ts,
    updatedAt: ts,
  });
}
