import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/ws-rules-expiry";
const KEY = encodeWorkspaceKey(CWD);

let server: TestServer;

afterEach(async () => {
  if (server) await server.close();
});

describe("GET /api/workspaces/:key/rules", () => {
  it("excludes an expired overlay rule (asOf)", async () => {
    server = await startTestBridge();
    mkdirSync(join(server.storePath, "rules"), { recursive: true });
    writeFileSync(
      join(server.storePath, "rules", `${KEY}.jsonl`),
      `${JSON.stringify({
        id: "e0000000-0000-4000-8000-000000000001",
        projectId: "11111111-1111-4111-8111-111111111111",
        title: "expired overlay",
        rule: "use the old way",
        appliesTo: [],
        evidence: [],
        severity: "info",
        confidence: "medium",
        createdFrom: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z", // far past any real clock
      })}\n`,
    );
    const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`);
    const body = (await res.json()) as { id: string }[];
    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});
