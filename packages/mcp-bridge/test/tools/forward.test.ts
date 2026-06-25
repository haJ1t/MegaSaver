import { describe, expect, it, vi } from "vitest";
import { forwardOrFallback } from "../../src/tools/forward.js";

// ponytail: vi.mock hoisted — getRunningDaemon is the ONLY export we need from daemon.
vi.mock("@megasaver/daemon", () => ({
  getRunningDaemon: vi.fn(),
}));

import { getRunningDaemon } from "@megasaver/daemon";

const mockGetRunningDaemon = vi.mocked(getRunningDaemon);

function makeFakeHandle(response: Response) {
  return {
    url: "http://127.0.0.1:12345",
    token: "test-token",
    request: vi.fn().mockResolvedValue(response),
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errResponse(status: number): Response {
  return new Response(JSON.stringify({ error: "denied" }), { status });
}

describe("forwardOrFallback", () => {
  it("calls inProcess when getRunningDaemon returns null", async () => {
    mockGetRunningDaemon.mockResolvedValue(null);
    const inProcess = vi.fn().mockResolvedValue({ value: "in-process" });

    const result = await forwardOrFallback("/store", "/exec-registry", { x: 1 }, inProcess);

    expect(inProcess).toHaveBeenCalledOnce();
    expect(result).toEqual({ value: "in-process" });
  });

  it("returns mapResponse(json) on 2xx, inProcess NOT called", async () => {
    const handle = makeFakeHandle(okResponse({ foo: "bar" }));
    mockGetRunningDaemon.mockResolvedValue(handle);
    const inProcess = vi.fn();
    const mapResponse = vi.fn((j: unknown) => ({ mapped: (j as { foo: string }).foo }));

    const result = await forwardOrFallback(
      "/store",
      "/exec-registry",
      { x: 1 },
      inProcess,
      mapResponse,
    );

    expect(handle.request).toHaveBeenCalledWith("POST", "/exec-registry", { x: 1 });
    expect(mapResponse).toHaveBeenCalledWith({ foo: "bar" });
    expect(inProcess).not.toHaveBeenCalled();
    expect(result).toEqual({ mapped: "bar" });
  });

  it("falls back to inProcess on non-2xx response", async () => {
    const handle = makeFakeHandle(errResponse(400));
    mockGetRunningDaemon.mockResolvedValue(handle);
    const inProcess = vi.fn().mockResolvedValue({ fallback: true });

    const result = await forwardOrFallback("/store", "/exec-registry", { x: 1 }, inProcess);

    expect(inProcess).toHaveBeenCalledOnce();
    expect(result).toEqual({ fallback: true });
  });

  it("falls back to inProcess when handle.request throws", async () => {
    const handle = {
      url: "http://127.0.0.1:12345",
      token: "test-token",
      request: vi.fn().mockRejectedValue(new Error("network error")),
    };
    mockGetRunningDaemon.mockResolvedValue(handle);
    const inProcess = vi.fn().mockResolvedValue({ fallback: true });

    const result = await forwardOrFallback("/store", "/exec-registry", { x: 1 }, inProcess);

    expect(inProcess).toHaveBeenCalledOnce();
    expect(result).toEqual({ fallback: true });
  });

  it("falls back to inProcess when getRunningDaemon throws", async () => {
    mockGetRunningDaemon.mockRejectedValue(new Error("discovery error"));
    const inProcess = vi.fn().mockResolvedValue({ fallback: true });

    const result = await forwardOrFallback("/store", "/exec-registry", { x: 1 }, inProcess);

    expect(inProcess).toHaveBeenCalledOnce();
    expect(result).toEqual({ fallback: true });
  });

  it("default mapResponse is identity (no mapResponse arg)", async () => {
    const payload = { a: 1, b: "two" };
    const handle = makeFakeHandle(okResponse(payload));
    mockGetRunningDaemon.mockResolvedValue(handle);
    const inProcess = vi.fn();

    const result = await forwardOrFallback("/store", "/recall-registry", { x: 1 }, inProcess);

    expect(result).toEqual(payload);
    expect(inProcess).not.toHaveBeenCalled();
  });
});
