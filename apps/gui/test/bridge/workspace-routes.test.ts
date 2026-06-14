import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const KEY = encodeWorkspaceKey("/tmp/ws-a");

describe("workspace-scoped bridge routes", () => {
  let server: TestServer;

  afterEach(async () => {
    if (server) await server.close();
  });

  describe("dispatch + validation", () => {
    it("rejects a bad key shape with 400 validation_failed", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/NOTAKEY/rules`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    });

    it("405s a POST to a read-only segment", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`, { method: "POST" });
      expect(res.status).toBe(405);
    });

    it("returns 200 [] for rules on an empty store", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });
});
