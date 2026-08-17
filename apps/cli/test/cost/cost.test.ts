import type { ProxyUsageEvent } from "@megasaver/llm-proxy";
import { describe, expect, it } from "vitest";
import { runCost } from "../../src/commands/cost/index.js";

const usage = (o: Partial<ProxyUsageEvent> = {}): ProxyUsageEvent => ({
  id: "00000000-0000-4000-8000-000000000000",
  ts: "2026-08-06T10:00:00.000Z",
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 50,
  cacheReadTokens: 4000,
  cacheCreationTokens: 300,
  messageCount: 1,
  stream: false,
  ...o,
});

const base = {
  storeRoot: "/tmp/megasaver-cost-not-read",
  by: "project" as const,
  json: false,
  readUsage: async () => ({ events: [] as ProxyUsageEvent[], skippedLines: 0 }),
  readSavings: () => [],
  readMeta: () => new Map(),
};

describe("mega cost", () => {
  it("reports the onboarding hint when no receipts exist", async () => {
    const out = await runCost({ ...base });
    expect(out).toContain("No receipts recorded yet");
    expect(out).toContain("mega proxy start");
  });

  it("renders stamped and UNKNOWN spend groups with totals", async () => {
    const out = await runCost({
      ...base,
      readUsage: async () => ({
        events: [usage({ workspaceKey: "00000000000000aa" }), usage()],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("00000000000000aa");
    expect(out).toContain("UNKNOWN");
    expect(out).toContain("receipts: 2 (2 spend, 0 measured savings, 0 unmeasured savings rows)");
    expect(out).toContain("tokens, not dollars");
  });

  it("session facet: unstamped spend lands entirely in UNKNOWN", async () => {
    const out = await runCost({
      ...base,
      by: "session",
      readUsage: async () => ({
        events: [usage({ workspaceKey: "00000000000000aa" })],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("UNKNOWN");
    expect(out).not.toContain("00000000000000aa");
  });

  it("shows measured savings only; unmeasured rows are counted, never converted", async () => {
    const out = await runCost({
      ...base,
      readSavings: () => [
        {
          createdAt: "2026-08-06T10:00:00.000Z",
          project: "00000000000000aa",
          session: "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6",
          deltaTokens: 500,
        },
        {
          createdAt: "2026-08-06T10:00:00.000Z",
          project: "00000000000000aa",
          session: "1af7f8f0-2b3c-4d5e-8f60-718293a4b5c6",
        },
      ],
    });
    expect(out).toContain("500");
    // Per-group unmeasured column (spec Goal: per-group measured/unmeasured
    // savings receipt counts), plus the overall total in the summary line.
    expect(out).toMatch(/^group\b.*\bunmeasured$/m);
    expect(out).toContain("1 unmeasured savings rows");
    expect(out).toContain("never converted or extrapolated");
  });

  it("windows receipts with sinceMs", async () => {
    const out = await runCost({
      ...base,
      sinceMs: Date.parse("2026-08-06T00:00:00.000Z"),
      readUsage: async () => ({
        events: [usage(), usage({ ts: "2026-08-01T00:00:00.000Z" })],
        skippedLines: 0,
      }),
    });
    expect(out).toContain("receipts: 1 (1 spend, 0 measured savings, 0 unmeasured savings rows)");
  });

  it("emits machine-readable JSON with UNKNOWN pinned last", async () => {
    const out = await runCost({
      ...base,
      json: true,
      readUsage: async () => ({
        events: [usage(), usage({ workspaceKey: "00000000000000aa" })],
        skippedLines: 2,
      }),
    });
    const parsed = JSON.parse(out);
    expect(parsed.facet).toBe("project");
    expect(parsed.skippedUsageLines).toBe(2);
    expect(parsed.groups.at(-1).key).toBe("UNKNOWN");
    expect(parsed.totals.inputTokens).toBe(2000);
  });

  it("renders the torn-line warning when the usage reader reports skips", async () => {
    const out = await runCost({
      ...base,
      readUsage: async () => ({ events: [usage()], skippedLines: 3 }),
    });
    expect(out).toContain("⚠ 3 unreadable usage lines skipped");
  });
});
