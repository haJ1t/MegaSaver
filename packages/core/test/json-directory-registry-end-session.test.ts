import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePersistenceError, CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const STARTED_AT = "2026-05-08T12:00:00.000Z";
const ENDED_AT = "2026-05-08T13:00:00.000Z";

describe("createJsonDirectoryCoreRegistry — endSession", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-end-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function seed(registry: ReturnType<typeof createJsonDirectoryCoreRegistry>): void {
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: STARTED_AT,
      updatedAt: STARTED_AT,
    });
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: agentIdSchema.parse("claude-code"),
      riskLevel: riskLevelSchema.parse("medium"),
      title: "first session",
      startedAt: STARTED_AT,
      endedAt: null,
    });
  }

  it("persists endedAt to sessions.json and returns the updated entity", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    expect(ended.endedAt).toBe(ENDED_AT);
    const persisted = JSON.parse(await readFile(join(rootDir, "sessions.json"), "utf8")) as Array<{
      id: string;
      endedAt: string | null;
    }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.endedAt).toBe(ENDED_AT);
  });

  it("throws session_not_found for an unknown id (no file mutation)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    const before = await readFile(join(rootDir, "sessions.json"), "utf8");
    const unknownId = sessionIdSchema.parse("33333333-3333-4333-8333-333333333333");

    let err: unknown;
    try {
      registry.endSession(unknownId, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_not_found");

    const after = await readFile(join(rootDir, "sessions.json"), "utf8");
    expect(after).toBe(before);
  });

  it("throws session_already_ended on the second call (idempotency rejected by design)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: "2026-05-08T14:00:00.000Z" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_already_ended");
  });

  it("releases the .projects.lock after a successful end", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });
    expect(ended.endedAt).toBe(ENDED_AT);

    expect(existsSync(join(rootDir, ".projects.lock"))).toBe(false);
  });

  it("blocks while a stale lock holder PID is alive (5s timeout, surfaces CorePersistenceError)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    await writeFile(join(rootDir, ".projects.lock"), String(process.pid), "utf8");

    const start = Date.now();
    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(CorePersistenceError);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
  }, 10000);

  it("recovers immediately when the lock holder PID is dead", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    await writeFile(join(rootDir, ".projects.lock"), "99999999", "utf8");

    const start = Date.now();
    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });
    const elapsed = Date.now() - start;
    expect(ended.endedAt).toBe(ENDED_AT);
    expect(elapsed).toBeLessThan(2000);
  });
});
