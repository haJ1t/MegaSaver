import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRIDGE_ERROR_CODES } from "../../src/bridge-error-code.js";
import {
  PROJECT_A,
  PROJECT_B,
  SESSION_A_ENDED,
  SESSION_A_OPEN,
  type TestServer,
  startTestBridge,
} from "./test-helpers.js";

const UNKNOWN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const UNKNOWN_SESSION_ID = "88888888-8888-4888-8888-888888888888";

type Fixture = {
  label: string;
  expectStatus: number;
  expectCode: (typeof BRIDGE_ERROR_CODES)[number];
  run: (baseUrl: string) => Promise<Response>;
};

const FIXTURES: Fixture[] = [
  {
    label: "GET /api/sessions?projectId=<unknown>",
    expectStatus: 404,
    expectCode: "project_not_found",
    run: (b) => fetch(`${b}/api/sessions?projectId=${UNKNOWN_PROJECT_ID}`),
  },
  {
    label: "GET /api/memory?projectId=<unknown>",
    expectStatus: 404,
    expectCode: "project_not_found",
    run: (b) => fetch(`${b}/api/memory?projectId=${UNKNOWN_PROJECT_ID}`),
  },
  {
    label: "GET /api/sessions?projectId=not-a-uuid",
    expectStatus: 400,
    expectCode: "validation_failed",
    run: (b) => fetch(`${b}/api/sessions?projectId=not-a-uuid`),
  },
  {
    label: "POST /api/sessions with missing agentId",
    expectStatus: 400,
    expectCode: "validation_failed",
    run: (b) =>
      fetch(`${b}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: PROJECT_A.id }),
      }),
  },
  {
    label: "POST /api/sessions with unknown projectId",
    expectStatus: 404,
    expectCode: "project_not_found",
    run: (b) =>
      fetch(`${b}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: UNKNOWN_PROJECT_ID, agentId: "claude-code" }),
      }),
  },
  {
    label: "POST /api/sessions/:id/end on already-ended",
    expectStatus: 409,
    expectCode: "session_already_ended",
    run: (b) =>
      fetch(`${b}/api/sessions/${SESSION_A_ENDED.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
  },
  {
    label: "POST /api/sessions/:id/end on unknown id",
    expectStatus: 404,
    expectCode: "session_not_found",
    run: (b) =>
      fetch(`${b}/api/sessions/${UNKNOWN_SESSION_ID}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
  },
  {
    label: "PATCH /api/sessions/:id with empty patch",
    expectStatus: 400,
    expectCode: "validation_failed",
    run: (b) =>
      fetch(`${b}/api/sessions/${SESSION_A_OPEN.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
  },
  {
    label: "PATCH /api/sessions/:id on ended session",
    expectStatus: 409,
    expectCode: "session_already_ended",
    run: (b) =>
      fetch(`${b}/api/sessions/${SESSION_A_ENDED.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      }),
  },
  {
    label: "POST /api/memory scope=session linking ended session",
    expectStatus: 409,
    expectCode: "session_already_ended",
    run: (b) =>
      fetch(`${b}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_A.id,
          content: "x",
          scope: "session",
          sessionId: SESSION_A_ENDED.id,
        }),
      }),
  },
  {
    label: "POST /api/memory scope=session linking cross-project session",
    expectStatus: 409,
    expectCode: "session_project_mismatch",
    run: (b) =>
      fetch(`${b}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_B.id,
          content: "x",
          scope: "session",
          sessionId: SESSION_A_OPEN.id,
        }),
      }),
  },
  {
    label: "GET /api/no-such-thing",
    expectStatus: 404,
    expectCode: "route_not_found",
    run: (b) => fetch(`${b}/api/no-such-thing`),
  },
  {
    label: "non-loopback origin",
    expectStatus: 403,
    expectCode: "origin_forbidden",
    run: (b) => fetch(`${b}/api/health`, { headers: { origin: "http://evil.example.com" } }),
  },
];

describe("createBridgeHandler — drift guard: every error path emits the locked envelope", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge({
      projects: [PROJECT_A, PROJECT_B],
      sessions: [SESSION_A_OPEN, SESSION_A_ENDED],
    });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.label} → ${fixture.expectStatus} + code=${fixture.expectCode} + locked envelope`, async () => {
      const res = await fixture.run(server.baseUrl);
      expect(res.status).toBe(fixture.expectStatus);
      const body = (await res.json()) as {
        error?: unknown;
        code?: unknown;
        details?: unknown;
      };
      // Envelope shape: { error: string, code: BridgeErrorCode, details?: unknown }
      expect(typeof body.error).toBe("string");
      expect((body.error as string).length).toBeGreaterThan(0);
      expect(typeof body.code).toBe("string");
      expect(BRIDGE_ERROR_CODES).toContain(body.code as string);
      expect(body.code).toBe(fixture.expectCode);
    });
  }
});
