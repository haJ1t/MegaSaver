import { describe, expect, it } from "vitest";
import { exportSavings } from "../src/index.js";
import type { HistoryPoint } from "../src/index.js";

const points: HistoryPoint[] = [
  { bucket: "2026-01-01", tokensSaved: 250, dollarsSaved: 0.00075, events: 2 },
  { bucket: "2026-01-02", tokensSaved: 200, dollarsSaved: 0.0006, events: 1 },
];

describe("exportSavings — csv", () => {
  it("emits a header row plus one row per point", () => {
    const csv = exportSavings(points, "csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("bucket,tokensSaved,dollarsSaved,events");
    expect(lines[1]).toBe("2026-01-01,250,0.00075,2");
    expect(lines[2]).toBe("2026-01-02,200,0.0006,1");
    expect(lines).toHaveLength(3);
  });

  it("quotes and escapes fields containing a comma, quote, or newline", () => {
    const tricky: HistoryPoint[] = [
      { bucket: "a,b", tokensSaved: 1, dollarsSaved: 0, events: 0 },
      { bucket: 'has"quote', tokensSaved: 1, dollarsSaved: 0, events: 0 },
      { bucket: "line\nbreak", tokensSaved: 1, dollarsSaved: 0, events: 0 },
    ];
    const lines = exportSavings(tricky, "csv").split("\n");
    // header + 3 data lines; the newline field keeps its embedded newline inside quotes,
    // so join-by-\n still yields exactly one extra physical line for it.
    expect(lines[0]).toBe("bucket,tokensSaved,dollarsSaved,events");
    expect(lines[1]).toBe('"a,b",1,0,0');
    expect(lines[2]).toBe('"has""quote",1,0,0');
    expect(exportSavings(tricky, "csv")).toContain('"line\nbreak",1,0,0');
  });

  it("returns just the header for an empty input", () => {
    expect(exportSavings([], "csv")).toBe("bucket,tokensSaved,dollarsSaved,events");
  });
});

describe("exportSavings — json", () => {
  it("returns JSON.stringify of the rows", () => {
    expect(exportSavings(points, "json")).toBe(JSON.stringify(points));
  });

  it("returns [] for empty input", () => {
    expect(exportSavings([], "json")).toBe("[]");
  });
});
