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

  it("rejects unknown fields", () => {
    const result = projectSchema.safeParse({
      ...validProject,
      claudeMdPath: "/tmp/CLAUDE.md",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
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

  it("normalizes name to NFC form", () => {
    const NOW = "2026-05-08T12:00:00.000Z";
    // NFD input: "caf" + e (U+0065) + combining acute accent (U+0301) = 5 chars
    const nfdName = "café";
    const parsed = projectSchema.parse({
      id: PROJECT_ID,
      name: nfdName,
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // NFC output: "caf" + e-with-acute (U+00E9) = 4 chars
    expect(parsed.name).toBe("café");
    expect(parsed.name.length).toBe(4);
  });

  it("re-parsing transformed output is byte-equal", () => {
    const NOW = "2026-05-08T12:00:00.000Z";
    // Use explicit \u escapes to lock the byte sequence regardless of
    // how the editor saves multibyte characters in the source file.
    const nfdInput = "café"; // NFD: 5 code units
    const nfcExpected = "café"; // NFC: 4 code units
    const first = projectSchema.parse({
      id: PROJECT_ID,
      name: nfdInput,
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(first.name).toBe(nfcExpected);
    expect(first.name.length).toBe(4);
    // Second parse on already-NFC output is a no-op (idempotent).
    const second = projectSchema.parse(first);
    expect(second.name).toBe(first.name);
    expect(second.name.length).toBe(4);
  });

  it("does not normalize rootPath", () => {
    const NOW = "2026-05-08T12:00:00.000Z";
    // NFD bytes in rootPath — schema must not touch it
    const rootPath = "/tmp/café";
    const parsed = projectSchema.parse({
      id: PROJECT_ID,
      name: "demo",
      rootPath,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.rootPath).toBe(rootPath);
  });
});
