import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readJsonBody } from "../src/body.js";

// Minimal IncomingMessage stand-in: emits data/end like a real request stream.
function fakeReq(body: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  queueMicrotask(() => {
    if (body.length > 0) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

describe("readJsonBody", () => {
  it("parses a JSON body", async () => {
    await expect(readJsonBody(fakeReq('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("resolves an empty body to {}", async () => {
    await expect(readJsonBody(fakeReq(""))).resolves.toEqual({});
  });

  it("rejects invalid JSON", async () => {
    await expect(readJsonBody(fakeReq("not json"))).rejects.toBeInstanceOf(Error);
  });

  it("rejects a body over the size cap", async () => {
    const huge = `{"x":"${"a".repeat(40)}"}`;
    await expect(readJsonBody(fakeReq(huge), 8)).rejects.toThrow(/too large/);
  });
});
