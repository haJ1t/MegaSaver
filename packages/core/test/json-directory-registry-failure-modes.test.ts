import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CorePersistenceError, createJsonDirectoryCoreRegistry } from "../src/index.js";
import { describeUnlessWindows } from "./_platform.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = join(tmpdir(), `megasaver-core-fail-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function expectPersistenceError(action: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CorePersistenceError);
  expect((thrown as CorePersistenceError).code).toBe(code);
}

// EACCES tests have no effect when running as root.
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("createJsonDirectoryCoreRegistry — failure modes", () => {
  it("listProjects surfaces dir-shaped projects.json as store_read_failed", () => {
    const rootDir = makeRoot();
    // Create a directory where projects.json should be a file.
    mkdirSync(join(rootDir, "projects.json"));
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    expectPersistenceError(() => registry.listProjects(), "store_read_failed");
  });

  it("listProjects surfaces invalid JSON as store_json_invalid", () => {
    const rootDir = makeRoot();
    writeFileSync(join(rootDir, "projects.json"), "not json {{{", "utf8");
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    expectPersistenceError(() => registry.listProjects(), "store_json_invalid");
  });

  it("listProjects surfaces malformed entity (missing required fields) as store_entity_invalid", () => {
    const rootDir = makeRoot();
    // Valid JSON array, but the object is missing required Project fields.
    writeFileSync(
      join(rootDir, "projects.json"),
      JSON.stringify([{ id: "not-a-uuid", name: 42 }]),
      "utf8",
    );
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    expectPersistenceError(() => registry.listProjects(), "store_entity_invalid");
  });

  describeUnlessWindows("POSIX permission failures (chmod mode bits)", () => {
    (isRoot ? it.skip : it)(
      "listProjects surfaces unreadable projects.json as store_read_failed",
      () => {
        const rootDir = makeRoot();
        const filePath = join(rootDir, "projects.json");
        writeFileSync(filePath, "[]", "utf8");
        chmodSync(filePath, 0o000);
        try {
          const registry = createJsonDirectoryCoreRegistry({ rootDir });
          expectPersistenceError(() => registry.listProjects(), "store_read_failed");
        } finally {
          chmodSync(filePath, 0o600);
        }
      },
    );

    (isRoot ? it.skip : it)(
      "createProject surfaces unwritable directory as store_write_failed",
      () => {
        const rootDir = makeRoot();
        // Seed an existing projects.json so the registry can read it on write.
        writeFileSync(join(rootDir, "projects.json"), "[]", "utf8");
        // Make the directory itself unwritable so atomicWriteFile cannot rename.
        chmodSync(rootDir, 0o500);
        try {
          const registry = createJsonDirectoryCoreRegistry({ rootDir });
          const project = {
            id: projectIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            name: "Fail Project",
            rootPath: "/tmp/fail-project",
            createdAt: "2026-05-07T10:00:00.000Z",
            updatedAt: "2026-05-07T10:00:00.000Z",
          };
          expectPersistenceError(() => registry.createProject(project), "store_write_failed");
        } finally {
          chmodSync(rootDir, 0o700);
        }
      },
    );
  });
});
