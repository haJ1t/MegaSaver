import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendProxyUsage, listProxyUsage } from "../src/store.js";
import type { ProxyUsageEvent } from "../src/usage-event.js";

const mk = (over: Partial<ProxyUsageEvent>): ProxyUsageEvent => ({
  id: "00000000-0000-4000-8000-000000000000",
  ts: "2026-06-24T12:00:00.000Z",
  model: "claude-opus-4-8",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  messageCount: 3,
  stream: false,
  ...over,
});

describe("proxy usage store", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "llm-proxy-store-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns [] when nothing recorded", async () => {
    expect(await listProxyUsage({ storeRoot: root })).toEqual([]);
  });

  it("append then list round-trips, in order", async () => {
    await appendProxyUsage({ storeRoot: root, event: mk({ id: "a", inputTokens: 1 }) });
    await appendProxyUsage({ storeRoot: root, event: mk({ id: "b", inputTokens: 2 }) });
    const all = await listProxyUsage({ storeRoot: root });
    expect(all.map((e) => e.id)).toEqual(["a", "b"]);
    expect(all[1]?.inputTokens).toBe(2);
  });

  it("rejects an invalid event", async () => {
    await expect(
      appendProxyUsage({
        storeRoot: root,
        event: mk({ inputTokens: -5 }),
      }),
    ).rejects.toThrow();
  });
});
