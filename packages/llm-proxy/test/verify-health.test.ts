import { describe, expect, it, vi } from "vitest";
import { HEALTH_PATH, buildHealthResponse, computeHealthProof } from "../src/health.js";
import { probeIsMegasaverProxy } from "../src/verify-health.js";

const CAP = "a".repeat(64);
const INSTANCE = "inst-1";
const URL_BASE = "http://127.0.0.1:8787";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("probeIsMegasaverProxy", () => {
  it("returns true for a well-formed proof answering our sent challenge", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const target = new URL(String(input));
      const challenge = target.searchParams.get("challenge") ?? "";
      expect(target.pathname).toBe(HEALTH_PATH);
      return jsonResponse(buildHealthResponse(CAP, INSTANCE, challenge));
    });

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns false for a wrong proof (wrong capability at the holder)", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const challenge = new URL(String(input)).searchParams.get("challenge") ?? "";
      return jsonResponse(buildHealthResponse("b".repeat(64), INSTANCE, challenge));
    });

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });

  it("returns false on a non-200 response (404)", async () => {
    const fetchImpl = vi.fn(async () => new Response("mega proxy: not found", { status: 404 }));

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });

  it("returns false when the holder reports a different instanceId", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const challenge = new URL(String(input)).searchParams.get("challenge") ?? "";
      return jsonResponse(buildHealthResponse(CAP, "other-instance", challenge));
    });

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });

  it("returns false when fetch throws (network error)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });

  it("returns false on a malformed JSON body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });

  it("returns false for a proof off by a single byte (constant-time compare guard)", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const challenge = new URL(String(input)).searchParams.get("challenge") ?? "";
      const good = computeHealthProof(CAP, INSTANCE, challenge);
      // Flip the last hex nibble so the proof stays the same length but differs
      // by one byte — a `===` mutant and a constant-time compare both reject it,
      // but a length-only or prefix compare would wrongly accept.
      const last = good.slice(-1);
      const flipped = last === "0" ? "1" : "0";
      const offByOne = `${good.slice(0, -1)}${flipped}`;
      return jsonResponse({
        service: "megasaver-proxy",
        instanceId: INSTANCE,
        challenge,
        proof: offByOne,
      });
    });

    const ok = await probeIsMegasaverProxy({
      url: URL_BASE,
      instanceId: INSTANCE,
      capability: CAP,
      challenge: "chal-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ok).toBe(false);
  });
});
