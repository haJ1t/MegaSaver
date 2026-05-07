import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePersistenceError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

describe("createJsonDirectoryCoreRegistry — lock", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-lock-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("createProject acquires + releases the .projects.lock", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const project = {
      id: projectIdSchema.parse("11111111-1111-4111-8111-111111111111"),
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: "2026-05-07T12:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    };
    registry.createProject(project);
    // After successful create, lock file must not be left behind
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(rootDir, ".projects.lock"))).toBe(false);
  });

  it("createProject surfaces store_write_failed when lock cannot be acquired", async () => {
    // Pre-create the lock file with restricted parent permissions so wx fails
    // and rm cannot recover. Simpler: pre-write the lock file and chmod 0500
    // on rootDir so the cleanup itself can't run inside the timeout.
    const { writeFile, chmod } = await import("node:fs/promises");
    await writeFile(join(rootDir, ".projects.lock"), "stale", "utf8");
    await chmod(rootDir, 0o500);
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    const project = {
      id: projectIdSchema.parse("22222222-2222-4222-8222-222222222222"),
      name: "demo2",
      rootPath: "/tmp/demo",
      createdAt: "2026-05-07T12:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    };
    let err: unknown;
    try {
      registry.createProject(project);
    } catch (e) {
      err = e;
    }
    await chmod(rootDir, 0o700).catch(() => undefined);
    expect(err).toBeDefined();
    expect((err as Error).constructor.name).toBe("CorePersistenceError");
    expect(err).toBeInstanceOf(CorePersistenceError);
  }, 10000); // 10s timeout (lock has 5s acquire timeout)
});
