import { formatDollarsSaved } from "@megasaver/stats";
import type { HistoryPoint, ProjectRow } from "./history.js";

export type ExportFormat = "csv" | "json";

export type SavingsRow = HistoryPoint | ProjectRow;

// The column order for an empty CSV export. A non-empty export derives its
// header from the first row's own key order, so day/week history and by-project
// rows each carry their own columns; only the empty case needs a default, and
// the history point is the primary export shape.
const DEFAULT_CSV_HEADER = ["bucket", "tokensSaved", "dollarsSaved", "events"];

// A field whose first char is = + - @ (or a tab/CR that a spreadsheet strips
// before the trigger) is executed as a formula when the CSV is opened in
// Excel/Sheets — an injection vector for attacker-controlled names. Prefix a
// single quote so the cell renders as literal text, then apply the normal
// comma/quote/newline quoting.
function escapeCsvField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

// The CSV is a savings *report*, so every dollar column (dollarsSaved and the
// insights dollarsReturned) shows the same floored display string as the free
// headline / audit report (formatDollarsSaved) — never the raw lossless number.
// Only JSON keeps the raw numeric fields.
function cell(col: string, value: unknown): string {
  if (col.startsWith("dollars")) return formatDollarsSaved(value as number);
  return String(value);
}

function toCsv(rows: readonly SavingsRow[]): string {
  const columns = rows.length === 0 ? DEFAULT_CSV_HEADER : Object.keys(rows[0] as object);
  const header = columns.map(escapeCsvField).join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => escapeCsvField(cell(col, (row as unknown as Record<string, unknown>)[col])))
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
