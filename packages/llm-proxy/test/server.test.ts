import { afterEach, describe, expect, it } from "vitest";
import { startProxyServer } from "../src/server.js";
import type { RunningProxy } from "../src/server.js";
import type { ProxyUsageEvent } from "../src/usage-event.js";

let running: RunningProxy | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

describe("startProxyServer (real localhost socket, fake upstream)", () => {
  it("binds 127.0.0.1, proxies a /v1/messages round-trip, and records usage", async () => {
    const events: ProxyUsageEvent[] = [];
    running = await startProxyServer({
      port: 0,
      upstreamBaseUrl: "https://api.anthropic.com",
      upstreamFetch: async (_url, _init) =>
        new Response('{"usage":{"input_tokens":12,"output_tokens":7}}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      onUsage: (e) => events.push(e),
      now: () => "2026-06-24T12:00:00.000Z",
      newId: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(running.url.startsWith("http://127.0.0.1:")).toBe(true);

    const resp = await fetch(`${running.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-secret" },
      body: JSON.stringify({ model: "claude-opus-4-8", messages: [{ role: "user" }] }),
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('{"usage":{"input_tokens":12,"output_tokens":7}}');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 12,
      outputTokens: 7,
      messageCount: 1,
    });
    // never leaks the secret
    expect(JSON.stringify(events[0])).not.toContain("sk-secret");
  });
});
