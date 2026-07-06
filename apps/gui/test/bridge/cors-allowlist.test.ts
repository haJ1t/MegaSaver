import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { applyCorsPolicy } from "../../bridge/cors.js";

function fakeReq(origin?: string): IncomingMessage {
  return { headers: origin === undefined ? {} : { origin } } as IncomingMessage;
}

const ALLOW = ["http://127.0.0.1:5174", "http://localhost:5174"] as const;

describe("applyCorsPolicy — parametrized allowlist", () => {
  it("allows an origin present in the supplied allowlist", () => {
    const res = {} as ServerResponse;
    const sendError = vi.fn();
    const decision = applyCorsPolicy(fakeReq("http://localhost:5174"), res, sendError, ALLOW);
    expect(decision).toEqual({ allowed: true, origin: "http://localhost:5174" });
    expect(sendError).not.toHaveBeenCalled();
  });

  it("rejects an origin absent from the allowlist → 403 origin_forbidden", () => {
    const res = {} as ServerResponse;
    const sendError = vi.fn();
    const decision = applyCorsPolicy(fakeReq("http://evil.com"), res, sendError, ALLOW);
    expect(decision).toEqual({ allowed: false });
    expect(sendError).toHaveBeenCalledWith(
      res,
      403,
      "origin_forbidden",
      expect.any(String),
      undefined,
    );
  });

  it("allows a request with no Origin header (curl / server-to-server)", () => {
    const res = {} as ServerResponse;
    const sendError = vi.fn();
    const decision = applyCorsPolicy(fakeReq(undefined), res, sendError, ALLOW);
    expect(decision).toEqual({ allowed: true, origin: undefined });
    expect(sendError).not.toHaveBeenCalled();
  });
});
