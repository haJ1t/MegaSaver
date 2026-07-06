import { describe, expect, it } from "vitest";
import { computeWasteBreakdown } from "../src/insights.js";

// Minimal TokenSaverEvent-shaped fixtures. Only the fields insights reads matter;
// the rest are filled to satisfy the type without affecting the math.
function ev(
  partial: {
    sourceKind: string;
    label: string;
    rawBytes: number;
    returnedBytes: number;
    bytesSaved: number;
  },
  i: number,
) {
  return {
    id: `e${i}`,
    sessionId: "s1",
    projectId: "p1",
    createdAt: "2026-07-01T00:00:00.000Z",
    sourceKind: partial.sourceKind,
    label: partial.label,
    rawBytes: partial.rawBytes,
    returnedBytes: partial.returnedBytes,
    bytesSaved: partial.bytesSaved,
    savingRatio: partial.rawBytes === 0 ? 0 : partial.bytesSaved / partial.rawBytes,
    summary: "",
    mode: "safe",
  } as never;
}

describe("computeWasteBreakdown", () => {
  it("groups by source, aggregates, ratios, sorts by returnedBytes desc", () => {
    const events = [
      // command: raw 1000, returned 900, saved 100 (poor compression, biggest returned)
      ev({ sourceKind: "command", label: "test", rawBytes: 1000, returnedBytes: 900, bytesSaved: 100 }, 0),
      ev({ sourceKind: "command", label: "test", rawBytes: 1000, returnedBytes: 900, bytesSaved: 100 }, 1),
      // file: raw 1000, returned 100, saved 900 (good compression, small returned)
      ev({ sourceKind: "file", label: "read", rawBytes: 1000, returnedBytes: 100, bytesSaved: 900 }, 2),
    ];
    const rows = computeWasteBreakdown(events, { by: "source" });
    expect(rows.map((r) => r.key)).toEqual(["command", "file"]); // 1800 returned > 100
    const cmd = rows[0]!;
    expect(cmd.events).toBe(2);
    expect(cmd.rawBytes).toBe(2000);
    expect(cmd.returnedBytes).toBe(1800);
    expect(cmd.bytesSaved).toBe(200);
    expect(cmd.savingRatio).toBeCloseTo(200 / 2000); // aggregate, not mean
    expect(cmd.returnedShare).toBeCloseTo(1800 / 1900);
    const file = rows[1]!;
    expect(file.returnedShare).toBeCloseTo(100 / 1900);
  });

  it("breaks ties by key asc", () => {
    const events = [
      ev({ sourceKind: "b", label: "x", rawBytes: 100, returnedBytes: 50, bytesSaved: 50 }, 0),
      ev({ sourceKind: "a", label: "y", rawBytes: 100, returnedBytes: 50, bytesSaved: 50 }, 1),
    ];
    expect(computeWasteBreakdown(events, { by: "source" }).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("groups by label when by=label", () => {
    const events = [
      ev({ sourceKind: "command", label: "grep", rawBytes: 100, returnedBytes: 80, bytesSaved: 20 }, 0),
      ev({ sourceKind: "command", label: "cat", rawBytes: 100, returnedBytes: 10, bytesSaved: 90 }, 1),
    ];
    expect(computeWasteBreakdown(events, { by: "label" }).map((r) => r.key)).toEqual(["grep", "cat"]);
  });

  it("rawBytes 0 -> savingRatio 0, no NaN", () => {
    const rows = computeWasteBreakdown(
      [ev({ sourceKind: "x", label: "x", rawBytes: 0, returnedBytes: 0, bytesSaved: 0 }, 0)],
      { by: "source" },
    );
    expect(rows[0]!.savingRatio).toBe(0);
    expect(Number.isNaN(rows[0]!.savingRatio)).toBe(false);
  });

  it("empty -> []", () => {
    expect(computeWasteBreakdown([], { by: "source" })).toEqual([]);
  });
});
