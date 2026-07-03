import { describe, expect, it, vi } from "vitest";
import {
  HEALTH_PATH,
  buildHealthResponse,
  computeHealthProof,
  verifyHealth,
} from "../src/health.js";
import { startProxyServer } from "../src/server.js";

const CAP = "a".repeat(64); // >=256-bit capability (hex)
const INSTANCE = "inst-1";

describe("computeHealthProof", () => {
  it("is a deterministic HMAC over instanceId||challenge keyed by capability", () => {
    const p1 = computeHealthProof(CAP, INSTANCE, "chal-1");
    const p2 = computeHealthProof(CAP, INSTANCE, "chal-1");
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with capability, instanceId, or challenge", () => {
    const base = computeHealthProof(CAP, INSTANCE, "chal-1");
    expect(computeHealthProof("b".repeat(64), INSTANCE, "chal-1")).not.toBe(base);
    expect(computeHealthProof(CAP, "inst-2", "chal-1")).not.toBe(base);
    expect(computeHealthProof(CAP, INSTANCE, "chal-2")).not.toBe(base);
  });
});

describe("buildHealthResponse", () => {
  it("returns service/instanceId/challenge/proof and NEVER the capability", () => {
    const r = buildHealthResponse(CAP, INSTANCE, "chal-9");
    expect(r).toEqual({
      service: "megasaver-proxy",
      instanceId: INSTANCE,
      challenge: "chal-9",
      proof: computeHealthProof(CAP, INSTANCE, "chal-9"),
    });
    expect(JSON.stringify(r)).not.toContain(CAP);
  });
});

describe("verifyHealth", () => {
  const expected = { capability: CAP, instanceId: INSTANCE };

  it("accepts a well-formed response for the sent challenge", () => {
    const probe = buildHealthResponse(CAP, INSTANCE, "sent-1");
    expect(verifyHealth(expected, probe, "sent-1")).toBe(true);
  });

  it("rejects a mismatched service marker", () => {
    const probe = { ...buildHealthResponse(CAP, INSTANCE, "s"), service: "evil" };
    expect(verifyHealth(expected, probe, "s")).toBe(false);
  });

  it("rejects a mismatched instanceId", () => {
    const probe = buildHealthResponse(CAP, "other", "s");
    expect(verifyHealth(expected, probe, "s")).toBe(false);
  });

  it("rejects a challenge that differs from the one we sent (replay)", () => {
    const probe = buildHealthResponse(CAP, INSTANCE, "old-challenge");
    expect(verifyHealth(expected, probe, "fresh-challenge")).toBe(false);
  });

  it("rejects an invalid proof (wrong capability)", () => {
    const probe = buildHealthResponse("b".repeat(64), INSTANCE, "s");
    expect(verifyHealth(expected, probe, "s")).toBe(false);
  });
});

describe("health endpoint on the proxy server", () => {
  it("answers the reserved health path locally and never forwards upstream", async () => {
    const upstreamFetch = vi.fn();
    const proxy = await startProxyServer({
      port: 0,
      upstreamBaseUrl: "https://api.anthropic.com",
      upstreamFetch: upstreamFetch as unknown as typeof fetch,
      health: { capability: CAP, instanceId: INSTANCE },
    });
    try {
      const res = await fetch(`${proxy.url}${HEALTH_PATH}?challenge=xyz`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.service).toBe("megasaver-proxy");
      expect(body.instanceId).toBe(INSTANCE);
      expect(body.challenge).toBe("xyz");
      expect(verifyHealth({ capability: CAP, instanceId: INSTANCE }, body, "xyz")).toBe(true);
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  it("without a configured capability, the reserved health path 404s and is NEVER forwarded", async () => {
    // The reserved path must never leak to the upstream as a normal request, even
    // when this instance has no ownership capability — otherwise a probe of the
    // path would be proxied to api.anthropic.com. It 404s locally instead.
    const upstreamFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const proxy = await startProxyServer({
      port: 0,
      upstreamBaseUrl: "https://api.anthropic.com",
      upstreamFetch: upstreamFetch as unknown as typeof fetch,
    });
    try {
      const res = await fetch(`${proxy.url}${HEALTH_PATH}?challenge=xyz`);
      expect(res.status).toBe(404);
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });
});
