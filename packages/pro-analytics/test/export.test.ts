import { formatDollarsSaved } from "@megasaver/stats";
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
    // The $ column is floored to the shared display string ($0.00 here).
    expect(lines[1]).toBe("2026-01-01,250,$0.00,2");
    expect(lines[2]).toBe("2026-01-02,200,$0.00,1");
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
    expect(lines[1]).toBe('"a,b",1,$0.00,0');
    expect(lines[2]).toBe('"has""quote",1,$0.00,0');
    expect(exportSavings(tricky, "csv")).toContain('"line\nbreak",1,$0.00,0');
  });

  it("returns just the header for an empty input", () => {
    expect(exportSavings([], "csv")).toBe("bucket,tokensSaved,dollarsSaved,events");
  });

  it("neutralizes fields starting with a spreadsheet formula trigger", () => {
    // A leading = + - @ (or tab/CR) executes as a formula in Excel/Sheets; the
    // field is prefixed with a single quote so it renders as literal text.
    const triggers: Array<[string, string]> = [
      ["=1+1", "'=1+1"],
      ["+1+1", "'+1+1"],
      ["-1+1", "'-1+1"],
      ["@SUM(1)", "'@SUM(1)"],
      ["\tcmd", "'\tcmd"],
      ["\rcmd", "'\rcmd"],
    ];
    for (const [raw, neutralized] of triggers) {
      const rows: HistoryPoint[] = [{ bucket: raw, tokensSaved: 1, dollarsSaved: 0, events: 0 }];
      const line = exportSavings(rows, "csv").split("\n")[1];
      expect(line).toBe(`${neutralized},1,$0.00,0`);
    }
  });

  it("neutralizes AND quotes a formula field that also needs escaping", () => {
    const rows: HistoryPoint[] = [{ bucket: '=1,"2', tokensSaved: 1, dollarsSaved: 0, events: 0 }];
    const line = exportSavings(rows, "csv").split("\n")[1];
    // prefixed with ' then comma+quote force the whole field into quotes.
    expect(line).toBe('"\'=1,""2",1,$0.00,0');
  });

  it("leaves a normal field unchanged", () => {
    const rows: HistoryPoint[] = [
      { bucket: "2026-01-01", tokensSaved: 1, dollarsSaved: 0, events: 0 },
    ];
    const line = exportSavings(rows, "csv").split("\n")[1];
    expect(line).toBe("2026-01-01,1,$0.00,0");
  });

  it("floors the dollarsSaved column via formatDollarsSaved (never rounds up)", () => {
    // raw $37.035 must display "$37.03" — the same floored string the free
    // headline / audit report shows, so the savings report never overstates.
    const rows: HistoryPoint[] = [
      { bucket: "2026-01-01", tokensSaved: 12_345_000, dollarsSaved: 37.035, events: 3 },
    ];
    const line = exportSavings(rows, "csv").split("\n")[1];
    expect(formatDollarsSaved(37.035)).toBe("$37.03");
    expect(line).toBe(`2026-01-01,12345000,${formatDollarsSaved(37.035)},3`);
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
