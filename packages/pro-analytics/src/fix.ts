import type { TokenSaverMode } from "@megasaver/shared";
import { INPUT_PRICE_PER_MTOK_USD, type TokenSaverEvent, tokensFromBytes } from "@megasaver/stats";
import { type WasteHeadline, computeWasteBreakdown, computeWasteHeadline } from "./insights.js";

export const FIX_MIN_EVENTS = 20;
export const FIX_CHATTY_SHARE = 0.25;
export const FIX_CHATTY_RATIO = 0.3;
export const FIX_READ_SHARE = 0.4;
export const FIX_WEAK_RATIO = 0.5;
export const FIX_WEAK_MIN_TOKENS = 1_000_000;
export const FIX_MEMORY_FILE_BYTES = 16_384;

export type FixActionKind =
  | "enable-saver"
  | "bump-saver-mode"
  | "advise-tool-route"
  | "advise-outline"
  | "advise-compress-memory-file";

export interface FixAction {
  kind: FixActionKind;
  appliable: boolean;
  title: string;
  detail: string;
  command: string | null;
  target: string | null;
  estDollarsReturned: number;
}

export interface FixSaverState {
  enabled: boolean;
  mode: TokenSaverMode;
}

export interface FixMemoryFile {
  path: string;
  bytes: number;
}

export interface FixPlan {
  headline: WasteHeadline;
  actions: FixAction[];
}

function dollarsFromTokens(tokens: number): number {
  return (tokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD;
}

export function computeFixPlan(
  events: readonly TokenSaverEvent[],
  opts: { saver: FixSaverState | null; memoryFiles: readonly FixMemoryFile[] },
): FixPlan {
  const headline = computeWasteHeadline(events);
  const bySource = computeWasteBreakdown(events, { by: "source" });
  const byLabel = computeWasteBreakdown(events, { by: "label" });
  const actions: FixAction[] = [];

  if (opts.saver === null || !opts.saver.enabled) {
    actions.push({
      kind: "enable-saver",
      appliable: true,
      title: "Token saver is off for this workspace",
      detail:
        "Every oversized tool output flows into context uncompressed. Enabling at balanced compresses them evidence-preservingly.",
      command: null,
      target: null,
      estDollarsReturned: headline.dollarsReturned,
    });
  } else if (
    opts.saver.mode === "safe" &&
    headline.overallSavingRatio < FIX_WEAK_RATIO &&
    headline.tokensReturned >= FIX_WEAK_MIN_TOKENS
  ) {
    actions.push({
      kind: "bump-saver-mode",
      appliable: true,
      title: "Saver runs at safe but most bytes still pass through",
      detail: `Saving ratio ${(headline.overallSavingRatio * 100).toFixed(0)}% over ${headline.tokensReturned} returned tokens. balanced tightens the budget; aggressive stays a manual choice.`,
      command: null,
      target: null,
      estDollarsReturned: headline.dollarsReturned * (1 - headline.overallSavingRatio),
    });
  }

  for (const row of bySource) {
    if (
      row.returnedShare >= FIX_CHATTY_SHARE &&
      row.savingRatio < FIX_CHATTY_RATIO &&
      row.events >= FIX_MIN_EVENTS
    ) {
      actions.push({
        kind: "advise-tool-route",
        appliable: false,
        title: `"${row.key}" returns ${(row.returnedShare * 100).toFixed(0)}% of context bytes and compresses poorly`,
        detail:
          "Register it with the tool router so task routing can exclude it when irrelevant (advisor; nothing is blocked silently).",
        command: `mega tools add <project> --name "${row.key}" --category mcp --risk caution`,
        target: row.key,
        estDollarsReturned: row.dollarsReturned,
      });
    }
  }

  const readRow = byLabel.find((r) => r.key === "read");
  if (readRow && readRow.returnedShare >= FIX_READ_SHARE && readRow.events >= FIX_MIN_EVENTS) {
    actions.push({
      kind: "advise-outline",
      appliable: false,
      title: `File reads return ${(readRow.returnedShare * 100).toFixed(0)}% of context bytes`,
      detail:
        "Prefer outline-first reads (proxy_read_file with outline: true) — signatures now, bodies on demand. Unchanged re-reads are already deduped automatically.",
      command: null,
      target: "read",
      estDollarsReturned: readRow.dollarsReturned,
    });
  }

  for (const f of opts.memoryFiles) {
    if (f.bytes > FIX_MEMORY_FILE_BYTES) {
      actions.push({
        kind: "advise-compress-memory-file",
        appliable: false,
        title: `${f.path} is ${Math.round(f.bytes / 1024)}KB — loaded into every session`,
        detail: "Compress or split it; a product memory-file compressor ships as its own module.",
        command: null,
        target: f.path,
        estDollarsReturned: dollarsFromTokens(tokensFromBytes(f.bytes)),
      });
    }
  }

  actions.sort(
    (a, b) =>
      b.estDollarsReturned - a.estDollarsReturned ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
  );
  return { headline, actions };
}
