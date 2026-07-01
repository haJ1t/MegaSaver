import type { ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { SessionFailureRecord } from "../src/registry-port.js";
import { buildSessionHints } from "../src/session-hints.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;

function failure(errorOutput: string): SessionFailureRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333" as SessionFailureRecord["id"],
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    command: "pnpm test",
    errorOutput,
    source: "proxy-classifier",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("buildSessionHints", () => {
  it("maps each failure's errorOutput into recentFailures in order", () => {
    const registry = {
      listSessionFailures: (projectId: ProjectId, sessionId: SessionId) => {
        expect(projectId).toBe(PROJECT_ID);
        expect(sessionId).toBe(SESSION_ID);
        return [failure("boom one"), failure("boom two")];
      },
    };

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toEqual(["boom one", "boom two"]);
    expect(hints.recentMemory).toBeUndefined();
    expect(hints.recentFiles).toBeUndefined();
  });

  it("returns an empty recentFailures list when there are no failures", () => {
    const registry = {
      listSessionFailures: () => [],
    };

    const hints = buildSessionHints(registry, PROJECT_ID, SESSION_ID);

    expect(hints.recentFailures).toEqual([]);
  });
});
