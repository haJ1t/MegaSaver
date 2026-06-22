import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { OFFICE_PROJECT_ID, ensureOfficeProject } from "../src/office-project.js";

const NOW = "2026-06-22T12:00:00.000Z";
const now = () => NOW;

describe("OFFICE_PROJECT_ID", () => {
  it("is the canonical sentinel", () => {
    expect(OFFICE_PROJECT_ID).toBe("00000000-beef-0000-0000-000000000001");
  });
});

describe("ensureOfficeProject", () => {
  it("seeds the office project when absent", () => {
    const core = createInMemoryCoreRegistry();
    expect(core.getProject(OFFICE_PROJECT_ID)).toBeNull();

    ensureOfficeProject(core, now);

    const project = core.getProject(OFFICE_PROJECT_ID);
    expect(project).not.toBeNull();
    expect(project?.id).toBe(OFFICE_PROJECT_ID);
    expect(project?.name).toBe("Agent Office");
    expect(project?.rootPath).toBe("office");
    expect(project?.createdAt).toBe(NOW);
  });

  it("is idempotent — second call does not throw", () => {
    const core = createInMemoryCoreRegistry();
    ensureOfficeProject(core, now);
    expect(() => ensureOfficeProject(core, now)).not.toThrow();
  });

  it("does not overwrite an existing project", () => {
    const core = createInMemoryCoreRegistry();
    ensureOfficeProject(core, () => "2026-01-01T00:00:00.000Z");
    ensureOfficeProject(core, () => "2026-12-31T00:00:00.000Z");

    const project = core.getProject(OFFICE_PROJECT_ID);
    // First call's timestamp preserved
    expect(project?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
