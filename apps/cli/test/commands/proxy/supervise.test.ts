import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProxyUsage } from "@megasaver/llm-proxy";
import type { ProxyUsageEvent, RunningProxy, StartProxyOptions } from "@megasaver/llm-proxy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runProxySupervise } from "../../../src/commands/proxy/supervise.js";

const EVENT: ProxyUsageEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  ts: "2026-06-24T12:00:00.000Z",
  model: "claude-opus-4-8",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  messageCount: 3,
  stream: false,
};

describe("runProxySupervise", () => {
  let store: string;
  beforeEach(() => {
    store = mkdtempSync(join(tmpdir(), "cli-proxy-"));
  });
  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  it("starts the server, prints the ANTHROPIC_BASE_URL line, and persists recorded usage", async () => {
    const lines: string[] = [];
    let captured: ((e: ProxyUsageEvent) => void) | undefined;
    const fakeStart = (opts: StartProxyOptions): Promise<RunningProxy> => {
      captured = opts.onUsage;
      return Promise.resolve({
        url: "http://127.0.0.1:8787",
        port: 8787,
        close: () => Promise.resolve(),
      });
    };

    await runProxySupervise({
      port: 8787,
      upstream: "https://api.anthropic.com",
      storeRoot: store,
      stdout: (l) => lines.push(l),
      startServer: fakeStart,
    });

    // prints the export line the operator needs
    expect(lines.some((l) => l.includes("export ANTHROPIC_BASE_URL=http://127.0.0.1:8787"))).toBe(
      true,
    );

    // a recorded usage event is persisted to the store
    if (captured === undefined) throw new Error("onUsage was not wired");
    captured(EVENT);
    await new Promise((r) => setTimeout(r, 10)); // let the best-effort persist flush
    const persisted = await listProxyUsage({ storeRoot: store });
    expect(persisted.map((e) => e.id)).toContain(EVENT.id);
  });
});
