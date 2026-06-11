import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEntryIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, expect, it } from "vitest";
import { CorePersistenceError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { describeUnlessWindows } from "./_platform.js";

const PROJECT_ID_A = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const roots: string[] = [];
const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};
const projectMemory = {
  id: MEMORY_ENTRY_ID_A,
  projectId: PROJECT_ID_A,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "Use strict ESM",
  content: "Repo uses strict ESM.",
  keywords: ["esm"],
  confidence: "high",
  source: "manual",
  stale: false,
  createdAt: "2026-05-04T12:30:00.000Z",
  updatedAt: "2026-05-04T12:30:00.000Z",
} as const;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makePath(): string {
  const root = join(tmpdir(), `megasaver-json-store-paths-${randomUUID()}`);
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

describeUnlessWindows("createJsonDirectoryCoreRegistry store path handling", () => {
  it("rejects an existing symlink root directory", () => {
    const outsideTarget = makePath();
    const rootSymlink = makePath();
    mkdirSync(outsideTarget, { recursive: true });
    symlinkSync(outsideTarget, rootSymlink, "dir");

    expectPersistenceError(
      () => createJsonDirectoryCoreRegistry({ rootDir: rootSymlink }),
      "store_root_invalid",
    );
  });

  it("rejects a symlinked memory directory before writing JSONL", () => {
    const root = makePath();
    const outsideTarget = makePath();
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideTarget, { recursive: true });
    symlinkSync(outsideTarget, join(root, "memory"), "dir");
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProject(projectA);

    expectPersistenceError(() => registry.createMemoryEntry(projectMemory), "store_write_failed");
    expect(readdirSync(outsideTarget)).toEqual([]);
  });
});
