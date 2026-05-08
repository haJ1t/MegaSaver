import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const STARTED_AT = "2026-05-08T12:00:00.000Z";
const ENDED_AT = "2026-05-08T13:00:00.000Z";

function seedProjectAndSession(registry: ReturnType<typeof createInMemoryCoreRegistry>): void {
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

describe("createInMemoryCoreRegistry — endSession", () => {
  it("sets endedAt on an open session and returns the updated entity", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);

    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    expect(ended.id).toBe(SESSION_ID);
    expect(ended.endedAt).toBe(ENDED_AT);
    const refetched = registry.getSession(SESSION_ID);
    expect(refetched?.endedAt).toBe(ENDED_AT);
  });

  it("throws session_not_found when the id is unknown", () => {
    const registry = createInMemoryCoreRegistry();
    const unknownId = sessionIdSchema.parse("33333333-3333-4333-8333-333333333333");

    let err: unknown;
    try {
      registry.endSession(unknownId, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_not_found");
  });

  it("throws session_already_ended on the second call", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);
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

  it("rejects an invalid endedAt via the existing Zod sessionSchema", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);

    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: "not-a-timestamp" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // ZodError or CorePersistenceError("store_entity_invalid") — either is acceptable
    // for the in-memory layer; the JSON-directory layer wraps it as the latter.
  });
});
