import type { HistoryPoint, ProjectRow } from "./history.js";

export type ExportFormat = "csv" | "json";

export type SavingsRow = HistoryPoint | ProjectRow;

// The column order for an empty CSV export. A non-empty export derives its
// header from the first row's own key order, so day/week history and by-project
// rows each carry their own columns; only the empty case needs a default, and
// the history point is the primary export shape.
const DEFAULT_CSV_HEADER = ["bucket", "tokensSaved", "dollarsSaved", "events"];

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: readonly SavingsRow[]): string {
  const columns = rows.length === 0 ? DEFAULT_CSV_HEADER : Object.keys(rows[0] as object);
  const header = columns.map(escapeCsvField).join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => escapeCsvField(String((row as unknown as Record<string, unknown>)[col])))
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function exportSavings(rows: readonly SavingsRow[], format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify(rows);
  }
  return toCsv(rows);
}
