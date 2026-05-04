import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Project, projectSchema } from "../src/project.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-05-04T12:00:00.000Z";
const UPDATED_AT = "2026-05-04T12:05:00.000Z";

const validProject = {
  id: PROJECT_ID,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

describe("projectSchema", () => {
  it("parses a valid project", () => {
    expect(projectSchema.parse(validProject)).toEqual(validProject);
  });

  it("trims name and rootPath", () => {
    expect(
      projectSchema.parse({
        ...validProject,
        name: "  Mega Saver  ",
        rootPath: "  /tmp/mega  ",
      }),
    ).toMatchObject({
      name: "Mega Saver",
      rootPath: "/tmp/mega",
    });
  });

  it("rejects empty name and rootPath after trimming", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      name: "   ",
      rootPath: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "name",
        "rootPath",
      ]);
    }
  });

  it("rejects invalid ids and datetimes", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      id: "not-a-uuid",
      createdAt: "today",
      updatedAt: "later",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "createdAt",
        "updatedAt",
      ]);
    }
  });

  it("property: non-empty names are accepted after trimming", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value.trim().length > 0),
        (name) => {
          expect(projectSchema.safeParse({ ...validProject, name }).success).toBe(true);
        },
      ),
    );
  });

  it("exports the inferred Project type", () => {
    expectTypeOf<Project>().toMatchTypeOf<{
      id: string;
      name: string;
      rootPath: string;
      createdAt: string;
      updatedAt: string;
    }>();
  });
});
