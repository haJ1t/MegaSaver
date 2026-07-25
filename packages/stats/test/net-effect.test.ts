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
  it("verdict ok when saved tokens exceed the excess", () => {
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: flatRows(20, 1000),
    });
    expect(v).toMatchObject({ workspaceKey: "wk1", verdict: "ok", excessTokens: 0 });
    expect(v?.savedTokens).toBe(1000);
  });

  // Pins what this estimator actually measures, so nobody re-promotes it to a
  // gate: identical total cache_creation — identical real cost — with only the
  // dispersion changed moves the number from 0 to the whole right tail. It is a
  // dispersion statistic, not a cost or causation statistic.
  it("is dispersion-only: same total cache_creation, different spread, different excess", () => {
    const workspaces = [
      { workspaceKey: "wk1", savedBytesInWindow: 40_000, compressionsInWindow: 20 },
    ];
    const flat = estimateNetEffect({ nowIso: NOW, workspaces, usageRows: flatRows(40, 3000) });
    const spread = estimateNetEffect({
      nowIso: NOW,
      workspaces,
      usageRows: Array.from({ length: 40 }, (_, i) => ({
        ts: IN_WINDOW,
        cacheCreationTokens: i % 2 === 0 ? 1000 : 5000,
        messageCount: 3 + i,
      })),
    });
    expect(flat[0]?.excessTokens).toBe(0);
    expect(spread[0]?.excessTokens).toBe(40_000);
    expect(flat[0]?.verdict).toBe("ok");
    expect(spread[0]?.verdict).toBe("negative");
  });

  it("verdict negative when the excess dwarfs savings", () => {
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
    expect(v?.excessTokens).toBe(100_000);
  });

  it("excess splits by compression share across workspaces", () => {
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

  it("excess within the 1.5x margin stays advisory-ok", () => {
    // saved 1000 tok (4000 B); excess 1200 → exceeds savings but stays inside the
    // margin, so ordinary dispersion does not raise the warning.
    const rows = [
      ...flatRows(19, 1000),
      { ts: IN_WINDOW, cacheCreationTokens: 2200, messageCount: 5 },
    ];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: rows,
    });
    expect(v?.excessTokens).toBe(1200);
    expect(v?.savedTokens).toBe(1000);
    expect(v?.verdict).toBe("ok");
  });

  it("excess beyond the 1.5x margin warns", () => {
    // saved 1000 tok; excess 1600 > 1500 → negative (advisory only, never a gate).
    const rows = [
      ...flatRows(19, 1000),
      { ts: IN_WINDOW, cacheCreationTokens: 2600, messageCount: 5 },
    ];
    const [v] = estimateNetEffect({
      nowIso: NOW,
      workspaces: [{ workspaceKey: "wk1", savedBytesInWindow: 4000, compressionsInWindow: 5 }],
      usageRows: rows,
    });
    expect(v?.excessTokens).toBe(1600);
    expect(v?.verdict).toBe("negative");
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
    expect(v?.excessTokens).toBe(0);
  });
});
