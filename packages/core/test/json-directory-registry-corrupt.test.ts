import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CorePersistenceError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

const PROJECT_ID_A = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID_A = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const MEMORY_ENTRY_ID_A = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const roots: string[] = [];
const projectA = {
  id: PROJECT_ID_A,
  name: "Mega Saver",
  rootPath: "/Users/halitozger/Desktop/MegaSaver",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:05:00.000Z",
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = join(tmpdir(), `megasaver-json-store-corrupt-${randomUUID()}`);
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

describe("createJsonDirectoryCoreRegistry corrupt store handling", () => {
  it("throws a persistence error for invalid projects JSON", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "projects.json"), "{bad");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.listProjects(), "store_json_invalid");
  });

  it("throws a persistence error for invalid sessions JSON", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "sessions.json"), "{bad");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getSession(SESSION_ID_A), "store_json_invalid");
  });

  it("throws a persistence error for invalid memory JSONL", () => {
    const root = makeRoot();
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", `${PROJECT_ID_A}.jsonl`), "{bad\n");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getMemoryEntry(MEMORY_ENTRY_ID_A), "store_json_invalid");
  });

  it("throws a persistence error for schema-invalid stored projects", () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "projects.json"),
      JSON.stringify([{ ...projectA, name: "   " }], null, 2),
    );

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.listProjects(), "store_entity_invalid");
  });

  it("throws a persistence error for blank memory JSONL lines", () => {
    const root = makeRoot();
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "memory", `${PROJECT_ID_A}.jsonl`), "\n");

    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });

    expectPersistenceError(() => registry.getMemoryEntry(MEMORY_ENTRY_ID_A), "store_json_invalid");
  });
});
