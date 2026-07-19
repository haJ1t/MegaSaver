import { describe, expect, it } from "vitest";
import { estimateNetEffect } from "../src/net-effect.js";

const NOW = "2026-07-19T12:00:00.000Z";
const IN_WINDOW = "2026-07-18T12:00:00.000Z";
const OLD = "2026-07-01T12:00:00.000Z";

const flatRows = (n: number, cc: number) =>
  Array.from({ length: n }, (_, i) => ({
    ts: IN_WINDOW,
    cacheCreationTokens: cc,
    messageCount: 3 + i,
  }));

describe("estimateNetEffect", () => {
  it("verdict ok when saved tokens exceed churn excess", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: flatRows(20, 1000),
    });
    expect(v).toMatchObject({ workspaceKey: "wk1", verdict: "ok", churnTokens: 0 });
    expect(v?.savedTokens).toBe(1000);
  });

  it("verdict negative when churn excess dwarfs savings", () => {
    const rows = [
      ...flatRows(19, 1000),
      { ts: IN_WINDOW, cacheCreationTokens: 101_000, messageCount: 5 },
    ];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: rows,
    });
    expect(v?.verdict).toBe("negative");
    expect(v?.churnTokens).toBe(100_000);
  });

  it("churn excess splits by compression share across workspaces", () => {
    const rows = [
      ...flatRows(19, 1000),
      { ts: IN_WINDOW, cacheCreationTokens: 41_000, messageCount: 5 },
    ];
    const out = estimateNetEffect({
      nowIso: NOW,
      workspaces: [
        { workspaceKey: "a", savedBytesInWindow: 400_000, compressionsInWindow: 3 },
        { workspaceKey: "b", savedBytesInWindow: 4000, compressionsInWindow: 1 },
      ],
      usageRows: rows,
    });
    expect(out.find((v) => v.workspaceKey === "a")?.verdict).toBe("ok");
    expect(out.find((v) => v.workspaceKey === "b")?.verdict).toBe("negative");
  });

  it("unknown when usage rows are insufficient (< 20 continuation rows in window)", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: flatRows(5, 1000),
    });
    expect(v?.verdict).toBe("unknown");
  });

  it("unknown when the workspace produced no compressions in window", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 0, compressionsInWindow: 0 }],
      usageRows: flatRows(25, 1000),
    });
    expect(v?.verdict).toBe("unknown");
  });

  it("ignores rows outside the 7-day window and first/second requests (messageCount < 3)", () => {
    const rows = [
      ...flatRows(20, 1000),
      { ts: OLD, cacheCreationTokens: 900_000, messageCount: 5 },
      { ts: IN_WINDOW, cacheCreationTokens: 900_000, messageCount: 2 },
    ];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 2 }],
      usageRows: rows,
    });
    expect(v?.verdict).toBe("ok");
    expect(v?.churnTokens).toBe(0);
  });
});
