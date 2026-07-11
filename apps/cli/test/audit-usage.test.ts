import type { ProxyUsageEvent } from "@megasaver/llm-proxy";
import { describe, expect, it } from "vitest";
import { runAuditUsage } from "../src/commands/audit/usage.js";

const event = (
  inputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): ProxyUsageEvent => ({
  id: "00000000-0000-4000-8000-000000000000",
  ts: "2026-07-01T00:00:00.000Z",
  model: "claude-sonnet-4-6",
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  messageCount: 1,
  stream: false,
});

const base = { storeRoot: "/tmp/x", cwd: "/tmp/ws", json: false };

describe("audit usage", () => {
  it("reports the onboarding hint when no proxy usage exists", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 0, byWorkspace: {} }),
      readUsage: async () => ({ events: [], skippedLines: 0 }),
    });
    expect(out).toContain("No proxy usage recorded yet");
  });

  it("computes both shares against real proxy usage", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 1000 } }),
      readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
    });
    // saved 1000 of would-be 10000 new context = 10.0%
    expect(out).toContain("saved of new context:       10.0%");
    expect(out).toContain("saved of total processed:   10.0%");
    expect(out).toContain("~1,000 tokens");
  });

  it("emits machine-readable JSON with the fused fields", async () => {
    const out = await runAuditUsage({
      ...base,
      json: true,
      readSavedAll: () => ({ totalTokens: 500, byWorkspace: { "wk-a": 500 } }),
      readUsage: async () => ({ events: [event(1000, 0, 90000, 0)], skippedLines: 0 }),
    });
    const parsed = JSON.parse(out);
    expect(parsed.savedTokens).toBe(500);
    expect(parsed.newContextTokens).toBe(1000);
    expect(parsed.totalContextTokens).toBe(91000);
    expect(parsed.savedShareOfNewContext).toBeCloseTo(500 / 1500, 10);
    expect(parsed.reliable).toBe(true); // 500 <= 1000
  });

  it("suppresses the % when saved exceeds the measured new context", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 5000, byWorkspace: { "wk-a": 5000 } }), // > new context (1000) => partial proxy coverage
      readUsage: async () => ({ events: [event(1000, 0, 0, 100)], skippedLines: 0 }),
    });
    expect(out).toContain("% suppressed");
    expect(out).not.toContain("saved of new context:");
  });

  it("windows the numerator to the earliest proxy-call timestamp", async () => {
    let receivedSince = -1;
    await runAuditUsage({
      ...base,
      readSavedAll: (_s, since) => {
        receivedSince = since;
        return { totalTokens: 100, byWorkspace: {} };
      },
      readUsage: async () => ({
        events: [
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T12:00:00.000Z" },
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T08:00:00.000Z" }, // earliest
          { ...event(1000, 0, 0, 0), ts: "2026-07-01T20:00:00.000Z" },
        ],
        skippedLines: 0,
      }),
    });
    expect(receivedSince).toBe(Date.parse("2026-07-01T08:00:00.000Z"));
  });

  it("F32: renders the skipped-line note when the reader reports torn lines", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 100, byWorkspace: {} }),
      readUsage: async () => ({ events: [event(1000, 0, 0, 0)], skippedLines: 2 }),
    });
    expect(out).toContain("⚠ 2 unreadable usage lines skipped");
  });

  it("F33: the ratio divides GLOBAL savings by global usage (all workspaces summed)", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 700, "wk-b": 300 } }),
      readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
    });
    expect(out).toContain("scope: all workspaces (global)");
    // 1000 / (1000 + 9000) — NOT just the cwd workspace's share
    expect(out).toContain("saved of new context:       10.0%");
  });

  it("F33: renders the per-workspace savings breakdown without ratios", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 700, "wk-b": 300 } }),
      readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
    });
    expect(out).toContain("savings by workspace");
    expect(out).toContain("wk-a  ~700 tokens");
    expect(out).toContain("wk-b  ~300 tokens");
    expect(out).not.toMatch(/wk-a.*%/);
  });

  it("F33: usage rows carrying workspaceKey get a scoped ratio; keyless stay global", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 600, "wk-b": 400 } }),
      readUsage: async () => ({
        events: [
          { ...event(2400, 0, 0, 0), workspaceKey: "wk-a" },
          event(5000, 0, 0, 0), // keyless -> global bucket
        ],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("workspace wk-a: saved ~600 of 2,400 new-context tokens (20.0%)");
    expect(out).toContain("scope: all workspaces (global)");
    // global bucket numerator excludes the 600 attributed to wk-a
    // (spacing-agnostic: renderUsageReport pads the label column)
    expect(out).toContain("~400 tokens (est, bytes/4)");
  });

  it("F34: clarifies that the proxy meters usage and saves nothing itself", async () => {
    const out = await runAuditUsage({
      ...base,
      readSavedAll: () => ({ totalTokens: 1000, byWorkspace: { "wk-a": 1000 } }),
      readUsage: async () => ({ events: [event(9000, 0, 0, 500)], skippedLines: 0 }),
    });
    expect(out).toContain("note: the proxy meters usage; savings come from the saver hook/tools");
  });
});
