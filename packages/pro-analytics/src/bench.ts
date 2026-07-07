import { INPUT_PRICE_PER_MTOK_USD, tokensFromBytes } from "@megasaver/stats";

export interface BenchPass {
  kind: "raw" | "saver";
  exitCode: number | null;
  wallMs: number;
  rawBytes: number;
  returnedBytes: number | null;
  savingRatio: number | null;
  signal: string | null;
}

export interface BenchParity {
  exitMatch: boolean;
  signalMatch: boolean | null;
  ok: boolean;
  note: string | null;
}

export interface BenchReport {
  command: string;
  raw: BenchPass;
  saver: BenchPass;
  tokensRaw: number;
  tokensReturned: number;
  tokensSaved: number;
  dollarsSaved: number;
  overheadMs: number;
  overheadPct: number;
  savingsNote: string | null;
  parity: BenchParity;
}

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

export function composeBenchReport(command: string, raw: BenchPass, saver: BenchPass): BenchReport {
  const incomplete = raw.exitCode === null || saver.exitCode === null;
  const exitMatch = !incomplete && raw.exitCode === saver.exitCode;
  const signalMatch =
    raw.signal === null && saver.signal === null ? null : raw.signal === saver.signal;
  const ok = !incomplete && exitMatch && signalMatch !== false;
  let note: string | null = null;
  if (incomplete) {
    note = "a run did not complete (spawn failure or timeout) — no parity claim";
  } else if (!ok) {
    note = "parity broken — the command may be nondeterministic; re-run to confirm";
  } else if (signalMatch === null) {
    note = "outcome compared by exit code only (output not classifiable)";
  }

  const tokensRaw = tokensFromBytes(raw.rawBytes);
  const tokensReturned = tokensFromBytes(saver.returnedBytes ?? saver.rawBytes);
  // Clamped to 0, but never silently: a saver pass that ADDED bytes gets an
  // explicit note so "0 saved" reads as "no net savings", not "no effect".
  const tokensSaved = Math.max(0, tokensRaw - tokensReturned);
  const savingsNote =
    tokensReturned > tokensRaw
      ? "saver returned more than raw on this pair — no net savings"
      : null;
  const overheadMs = saver.wallMs - raw.wallMs;
  return {
    command,
    raw,
    saver,
    tokensRaw,
    tokensReturned,
    tokensSaved,
    dollarsSaved: dollarsFromTokens(tokensSaved),
    overheadMs,
    overheadPct: raw.wallMs === 0 ? 0 : overheadMs / raw.wallMs,
    savingsNote,
    parity: { exitMatch, signalMatch, ok, note },
  };
}

function money(n: number): string {
  return `$${n.toFixed(2)} (est.)`;
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function ms(n: number): string {
  return `${Math.round(n)}ms`;
}

// Signals render inside inline code; backticks are replaced so a label can
// never break the code span.
function sig(s: string | null): string {
  return s === null ? "unknown" : `\`${s.replace(/`/g, "'")}\``;
}

export function renderBenchMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("# Same command, twice — a Mega Saver bench");
  lines.push("");
  lines.push("## The pair");
  lines.push("");
  lines.push(`Command: \`${report.command}\``);
  lines.push("");
  lines.push(
    "Order: raw first, then saver (fixed; a warm OS cache may slightly favor the second run).",
  );
  lines.push("");
  lines.push("## Tokens");
  lines.push("");
  lines.push("| pass | bytes captured | tokens |");
  lines.push("|---|---|---|");
  lines.push(`| raw | ${report.raw.rawBytes} | ${compactTokens(report.tokensRaw)} |`);
  lines.push(
    `| saver | ${report.saver.returnedBytes ?? report.saver.rawBytes} returned | ${compactTokens(report.tokensReturned)} |`,
  );
  lines.push("");
  lines.push(
    `Kept out of context: **${compactTokens(report.tokensSaved)} tokens ≈ ${money(report.dollarsSaved)}** per run.`,
  );
  if (report.savingsNote !== null) {
    lines.push("");
    lines.push(`Note: ${report.savingsNote}`);
  }
  lines.push("");
  lines.push("## Time");
  lines.push("");
  lines.push(
    `raw ${ms(report.raw.wallMs)} · saver ${ms(report.saver.wallMs)} · overhead ${ms(report.overheadMs)} (${(report.overheadPct * 100).toFixed(0)}%)`,
  );
  lines.push("");
  lines.push("## Outcome parity");
  lines.push("");
  lines.push(
    `**${report.parity.ok ? "PARITY OK" : "PARITY NOT CONFIRMED"}** · exit ${report.raw.exitCode} vs ${report.saver.exitCode} · signal ${sig(report.raw.signal)} vs ${sig(report.saver.signal)}`,
  );
  if (report.parity.note !== null) {
    lines.push("");
    lines.push(`Note: ${report.parity.note}`);
  }
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    `Dollar figures use a flat $${INPUT_PRICE_PER_MTOK_USD}/MTok input price and are estimates; tokens are byte-derived (≈4 bytes/token). Measured, not modeled — a single pair on this machine, raw first, then saver. Tool output content never appears in this report.`,
  );
  lines.push("");
  return lines.join("\n");
}
