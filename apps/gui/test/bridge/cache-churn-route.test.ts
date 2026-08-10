import type { TokenSaverEvent } from "@megasaver/stats";
import { describe, expect, it } from "vitest";
import { handleGetCacheChurn } from "../../bridge/routes/cache.js";

function makeCtx(readEvents: () => TokenSaverEvent[]) {
  let status = 0;
  let body: unknown;
  return {
    ctx: {
      res: {} as unknown as import("node:http").ServerResponse,
      origin: "http://localhost",
      now: () => "2026-08-10T10:00:00.000Z",
      sendJson: (_res: unknown, s: number, b: unknown) => {
        status = s;
        body = b;
      },
      storeRoot: "/tmp/gui-test",
      readEvents,
    } as unknown as import("../../bridge/route-context.js").RouteContext,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
  };
}

describe("handleGetCacheChurn", () => {
  it("returns live CacheChurnResult", async () => {
    const evt = {
      id: "a",
      savingRatio: 0.8,
      rawBytes: 1000,
      bytesSaved: 800,
      returnedBytes: 200,
    } as unknown as TokenSaverEvent;
    const h = makeCtx(() => [evt]);
    await handleGetCacheChurn(h.ctx);
    expect(h.status).toBe(200);
    expect(h.body).toHaveProperty("cacheInvalidationRate");
  });
  it("empty returns zero rate", async () => {
    const h = makeCtx(() => []);
    await handleGetCacheChurn(h.ctx);
    expect(h.body).toMatchObject({ cacheInvalidationRate: 0 });
  });
});
