import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createProxyHandler } from "../src/proxy-handler.js";
import type { ProxyUsageEvent } from "../src/usage-event.js";

// ── fakes ──────────────────────────────────────────────────────────────────
function makeReq(method: string, url: string, headers: Record<string, string>, body = "") {
  const r = Readable.from(body.length > 0 ? [Buffer.from(body)] : []) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  r.method = method;
  r.url = url;
  r.headers = headers;
  return r;
}

function makeRes() {
  const chunks: Buffer[] = [];
  let status = 0;
  let headers: Record<string, unknown> = {};
  return {
    res: {
      writeHead(s: number, h: Record<string, unknown>) {
        status = s;
        headers = h;
      },
      write(c: Buffer | string) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      },
      end(c?: Buffer | string) {
        if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      },
    },
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

const deps = (over: Partial<Parameters<typeof createProxyHandler>[0]> = {}) => ({
  upstreamBaseUrl: "https://api.anthropic.com",
  now: () => "2026-06-24T12:00:00.000Z",
  newId: () => "11111111-1111-4111-8111-111111111111",
  ...over,
});

describe("createProxyHandler", () => {
  it("forwards method/path/headers/body verbatim and streams the response back", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const upstreamFetch = vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{"usage":{"input_tokens":100,"output_tokens":50}}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const onUsage = vi.fn();
    const handler = createProxyHandler(deps({ upstreamFetch, onUsage }));
    const req = makeReq(
      "POST",
      "/v1/messages",
      { "x-api-key": "sk-secret", "content-type": "application/json" },
      JSON.stringify({ model: "claude-opus-4-8", messages: [{ role: "user" }, { role: "x" }] }),
    );
    const out = makeRes();
    await handler(req, out.res as never);

    expect(seen?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen?.init.method).toBe("POST");
    // auth header forwarded verbatim to upstream
    expect((seen?.init.headers as Record<string, string>)["x-api-key"]).toBe("sk-secret");
    // body forwarded
    expect(String(seen?.init.body)).toContain('"model":"claude-opus-4-8"');
    // response streamed back unchanged
    expect(out.status).toBe(200);
    expect(out.body).toBe('{"usage":{"input_tokens":100,"output_tokens":50}}');
  });

  it("records a usage event for POST /v1/messages (counts only, no auth/content)", async () => {
    const upstreamFetch = async () =>
      new Response(
        '{"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10}}',
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    let event: ProxyUsageEvent | null = null;
    const handler = createProxyHandler(
      deps({
        upstreamFetch,
        onUsage: (e) => {
          event = e;
        },
      }),
    );
    await handler(
      makeReq(
        "POST",
        "/v1/messages",
        { "x-api-key": "sk-secret" },
        JSON.stringify({ model: "claude-opus-4-8", messages: [{}, {}, {}] }),
      ),
      makeRes().res as never,
    );
    expect(event).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      ts: "2026-06-24T12:00:00.000Z",
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 0,
      messageCount: 3,
      stream: false,
    });
    // the event carries no secret + no body
    expect(JSON.stringify(event)).not.toContain("sk-secret");
  });

  it("parses usage from a streaming (SSE) response and marks stream=true", async () => {
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":80,"output_tokens":1}}}',
      "",
      'data: {"type":"message_delta","usage":{"output_tokens":40}}',
      "",
    ].join("\n");
    const upstreamFetch = async () =>
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    let event: ProxyUsageEvent | null = null;
    const handler = createProxyHandler(
      deps({
        upstreamFetch,
        onUsage: (e) => {
          event = e;
        },
      }),
    );
    await handler(
      makeReq("POST", "/v1/messages", {}, JSON.stringify({ model: "m", messages: [{}] })),
      makeRes().res as never,
    );
    expect(event?.stream).toBe(true);
    expect(event?.inputTokens).toBe(80);
    expect(event?.outputTokens).toBe(40);
  });

  it("does not record usage for non-/v1/messages paths", async () => {
    const upstreamFetch = async () => new Response("ok", { status: 200 });
    const onUsage = vi.fn();
    const handler = createProxyHandler(deps({ upstreamFetch, onUsage }));
    await handler(makeReq("GET", "/v1/models", {}), makeRes().res as never);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("forwards an upstream error without crashing and records no usage", async () => {
    const upstreamFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const onUsage = vi.fn();
    const handler = createProxyHandler(deps({ upstreamFetch, onUsage }));
    const out = makeRes();
    await handler(makeReq("POST", "/v1/messages", {}, "{}"), out.res as never);
    expect(out.status).toBeGreaterThanOrEqual(500);
    expect(onUsage).not.toHaveBeenCalled();
  });
});
