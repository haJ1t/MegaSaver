import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";
import { describe, expect, it } from "vitest";
import { computeSavingsByProject, computeSavingsHistory } from "../src/index.js";

// Minimal TokenSaverEvent factory — only the fields the analytics read
// (createdAt, bytesSaved, projectId) vary; the rest are filled with valid
// placeholders so the shape stays a real TokenSaverEvent.
function event(
  overrides: Partial<Omit<TokenSaverEvent, "projectId" | "sessionId">> & {
    createdAt: string;
    bytesSaved: number;
    projectId?: string;
    sessionId?: string;
  },
): TokenSaverEvent {
  return {
    id: overrides.id ?? "e1",
    sessionId: (overrides.sessionId ?? "sess-1") as TokenSaverEvent["sessionId"],
    projectId: (overrides.projectId ?? "proj-1") as TokenSaverEvent["projectId"],
    createdAt: overrides.createdAt,
    sourceKind: overrides.sourceKind ?? "file",
    label: overrides.label ?? "read",
    rawBytes: overrides.rawBytes ?? overrides.bytesSaved * 2,
    returnedBytes: overrides.returnedBytes ?? overrides.bytesSaved,
    bytesSaved: overrides.bytesSaved,
    savingRatio: overrides.savingRatio ?? 0.5,
    summary: overrides.summary ?? "summary",
    mode: overrides.mode ?? "balanced",
  };
}

const dollars = (tokens: number): number => (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;

describe("computeSavingsHistory — day bucket", () => {
  it("buckets events across 3 UTC days with correct per-day sums", () => {
    const events = [
      event({ createdAt: "2026-01-01T02:00:00.000Z", bytesSaved: 400 }),
      event({ createdAt: "2026-01-01T20:00:00.000Z", bytesSaved: 600 }),
      event({ createdAt: "2026-01-02T05:00:00.000Z", bytesSaved: 800 }),
      event({ createdAt: "2026-01-03T23:59:59.000Z", bytesSaved: 1200 }),
    ];

    const history = computeSavingsHistory(events, { bucket: "day" });

    expect(history).toHaveLength(3);
    expect(history.map((p) => p.bucket)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);

    const day1Tokens = tokensFromBytes(1000);
    expect(history[0]).toEqual({
      bucket: "2026-01-01",
      tokensSaved: day1Tokens,
      dollarsSaved: dollars(day1Tokens),
      events: 2,
    });
    expect(history[1]).toEqual({
      bucket: "2026-01-02",
      tokensSaved: tokensFromBytes(800),
      dollarsSaved: dollars(tokensFromBytes(800)),
      events: 1,
    });
    expect(history[2]).toEqual({
      bucket: "2026-01-03",
      tokensSaved: tokensFromBytes(1200),
      dollarsSaved: dollars(tokensFromBytes(1200)),
      events: 1,
    });
  });

  it("returns [] for no events", () => {
    expect(computeSavingsHistory([], { bucket: "day" })).toEqual([]);
  });

  it("is deterministic and sorted ascending by bucket regardless of input order", () => {
    const events = [
      event({ createdAt: "2026-01-03T10:00:00.000Z", bytesSaved: 100 }),
      event({ createdAt: "2026-01-01T10:00:00.000Z", bytesSaved: 100 }),
      event({ createdAt: "2026-01-02T10:00:00.000Z", bytesSaved: 100 }),
    ];
    const buckets = computeSavingsHistory(events, { bucket: "day" }).map((p) => p.bucket);
    expect(buckets).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });
});

describe("computeSavingsHistory — week bucket", () => {
  it("groups events by ISO week", () => {
    // 2026-01-01 (Thu) and 2026-01-04 (Sun) are ISO week 2026-W01;
    // 2026-01-05 (Mon) starts ISO week 2026-W02.
    const events = [
      event({ createdAt: "2026-01-01T10:00:00.000Z", bytesSaved: 400 }),
      event({ createdAt: "2026-01-04T10:00:00.000Z", bytesSaved: 600 }),
      event({ createdAt: "2026-01-05T10:00:00.000Z", bytesSaved: 800 }),
    ];

    const history = computeSavingsHistory(events, { bucket: "week" });

    expect(history.map((p) => p.bucket)).toEqual(["2026-W01", "2026-W02"]);
    expect(history[0]?.tokensSaved).toBe(tokensFromBytes(1000));
    expect(history[0]?.events).toBe(2);
    expect(history[1]?.tokensSaved).toBe(tokensFromBytes(800));
    expect(history[1]?.events).toBe(1);
  });
});

describe("computeSavingsByProject", () => {
  it("returns per-project rows sorted descending by tokensSaved", () => {
    const eventsByProject: Record<string, TokenSaverEvent[]> = {
      small: [
        event({ createdAt: "2026-01-01T00:00:00.000Z", bytesSaved: 400, projectId: "small" }),
      ],
      big: [
        event({ createdAt: "2026-01-01T00:00:00.000Z", bytesSaved: 4000, projectId: "big" }),
        event({ createdAt: "2026-01-02T00:00:00.000Z", bytesSaved: 4000, projectId: "big" }),
      ],
      mid: [event({ createdAt: "2026-01-01T00:00:00.000Z", bytesSaved: 2000, projectId: "mid" })],
    };

    const rows = computeSavingsByProject(eventsByProject);

    expect(rows.map((r) => r.project)).toEqual(["big", "mid", "small"]);
    expect(rows[0]).toEqual({
      project: "big",
      tokensSaved: tokensFromBytes(8000),
      dollarsSaved: dollars(tokensFromBytes(8000)),
      events: 2,
    });
    expect(rows[2]?.project).toBe("small");
  });

  it("returns [] for no projects", () => {
    expect(computeSavingsByProject({})).toEqual([]);
  });
});
