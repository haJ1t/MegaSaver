import {
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  MEGA_SAVER_HANDOFF_BLOCK_END,
  MEGA_SAVER_HANDOFF_BLOCK_START,
  MEGA_SAVER_WS_BLOCK_END,
  MEGA_SAVER_WS_BLOCK_START,
} from "./constants.js";
import { renderContextGateBlock } from "./context-gate-block.js";
import type { ConnectorContext } from "./context.js";
import { type IndexedLine, type SentinelPair, parseBlock, splitIndexedLines } from "./parse.js";
import { renderBlock } from "./render.js";

interface UpsertBlockInput {
  existingContent: string;
  context: ConnectorContext;
  // undefined = leave any existing WS block untouched; "" = remove; text = upsert.
  warmStartBlock?: string;
}

const CG_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_CG_BLOCK_START,
  end: MEGA_SAVER_CG_BLOCK_END,
};

const WS_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_WS_BLOCK_START,
  end: MEGA_SAVER_WS_BLOCK_END,
};

export function upsertBlock(input: UpsertBlockInput): string {
  const eol = detectDominantEol(input.existingContent);
  const normalized = input.existingContent.replace(/\r\n/g, "\n");

  // 1) Legacy block (default sentinels) — unchanged semantics.
  const legacyBlock = renderBlock(input.context);
  const afterLegacy = applyManagedBlock(normalized, legacyBlock);

  // 2) CONTEXT_GATE block — independent pair. Empty render ⇒ remove if present.
  const cgBlock = renderContextGateBlock(input.context);
  const result = applyOptionalBlock(afterLegacy, cgBlock, CG_SENTINELS);

  // 3) WARM_START block — independent pair, opt-in. undefined ⇒ leave untouched.
  const withWs =
    input.warmStartBlock === undefined
      ? result
      : applyOptionalBlock(result, input.warmStartBlock, WS_SENTINELS);

  return eol === "\r\n" ? withWs.replace(/\n/g, "\r\n") : withWs;
}

// Insert-or-replace the legacy managed block (default sentinels).
function applyManagedBlock(normalized: string, block: string): string {
  const parsed = parseBlock(normalized);
  if (parsed.block !== null) {
    return joinWithManagedBlock(parsed.before, parsed.after, block);
  }
  const humanContent = trimTrailingBoundaryForJoin(parsed.before);
  if (humanContent.length === 0) {
    return block;
  }
  return `${humanContent}\n\n${block}`;
}

// Insert-or-replace-or-remove a block under an explicit sentinel pair.
function applyOptionalBlock(normalized: string, block: string, sentinels: SentinelPair): string {
  const parsed = parseBlock(normalized, sentinels);
  if (block.length === 0) {
    if (parsed.block === null) return ensureTrailingNewline(normalized);
    const remaining = joinHumanContent(parsed.before, parsed.after);
    return remaining.trim().length === 0 ? "" : ensureTrailingNewline(remaining);
  }
  if (parsed.block !== null) {
    return joinWithManagedBlock(parsed.before, parsed.after, block);
  }
  const head = trimTrailingBoundaryForJoin(parsed.before);
  if (head.length === 0) return ensureTrailingNewline(block);
  return ensureTrailingNewline(`${head}\n\n${block}`);
}

// CONTEXT_GATE-only upsert. Unlike upsertBlock, it never touches the legacy
// managed block — used by the GUI workspace activation path, which has no
// connector context. Empty block ⇒ remove the CG block if present.
export function upsertContextGateBlockText(existingContent: string, block: string): string {
  const eol = detectDominantEol(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");
  const result = applyOptionalBlock(normalized, block, CG_SENTINELS);
  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

const HANDOFF_SENTINELS: SentinelPair = {
  start: MEGA_SAVER_HANDOFF_BLOCK_START,
  end: MEGA_SAVER_HANDOFF_BLOCK_END,
};

// HANDOFF-only upsert. Like upsertContextGateBlockText it never touches the
// legacy/CG/WS blocks — `mega handoff open`/`clear` have no ConnectorContext.
// Empty block ⇒ remove the HANDOFF block if present; when no block exists the
// input is returned byte-identical (no EOL/trailing-newline normalisation), so
// a repeated `mega handoff clear` never mutates a user file. Deliberately
// stricter than the CG variant; parseBlock still rejects corrupted sentinels.
export function upsertHandoffBlockText(existingContent: string, block: string): string {
  const eol = detectDominantEol(existingContent);
  const normalized = existingContent.replace(/\r\n/g, "\n");
  if (block.length === 0 && parseBlock(normalized, HANDOFF_SENTINELS).block === null) {
    return existingContent;
  }
  const result = applyOptionalBlock(normalized, block, HANDOFF_SENTINELS);
  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

export function removeBlock(content: string): string {
  const eol = detectDominantEol(content);
  const normalized = content.replace(/\r\n/g, "\n");

  let result: string;
  const parsed = parseBlock(normalized);
  if (parsed.block === null) {
    result = normalized.length === 0 ? "" : ensureTrailingNewline(normalized);
  } else {
    const remaining = joinHumanContent(parsed.before, parsed.after);
    if (remaining.trim().length === 0) {
      result = "";
    } else {
      result = ensureTrailingNewline(remaining);
    }
  }

  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

function joinWithManagedBlock(before: string, after: string, newBlock: string): string {
  const normalizedBefore = trimTrailingBoundaryForJoin(before);
  const normalizedAfter = trimLeadingBoundaryLines(after);
  const prefix = normalizedBefore.length === 0 ? "" : `${normalizedBefore}\n\n`;
  const suffix = normalizedAfter.length === 0 ? "" : `\n${normalizedAfter}`;
  return ensureTrailingNewline(`${prefix}${newBlock}${suffix}`);
}

function joinHumanContent(before: string, after: string): string {
  const normalizedBefore = trimTrailingBoundaryForJoin(before);
  const normalizedAfter = trimLeadingBoundaryLines(after);
  if (normalizedBefore.length === 0) return normalizedAfter;
  if (normalizedAfter.length === 0) return normalizedBefore;
  return `${normalizedBefore}\n\n${normalizedAfter}`;
}

function trimTrailingBoundaryLines(content: string): string {
  const lines = splitIndexedLines(content);
  let end = lines.length;
  while (end > 0 && normalizedLineIsBlank(lines[end - 1] as IndexedLine)) end -= 1;
  return lines
    .slice(0, end)
    .map((l) => l.raw)
    .join("");
}

function trimTrailingBoundaryForJoin(content: string): string {
  return trimTrailingBoundaryLines(content).replace(/\r?\n$/u, "");
}

function trimLeadingBoundaryLines(content: string): string {
  const lines = splitIndexedLines(content);
  let start = 0;
  while (start < lines.length && normalizedLineIsBlank(lines[start] as IndexedLine)) start += 1;
  return lines
    .slice(start)
    .map((l) => l.raw)
    .join("");
}

function normalizedLineIsBlank(line: IndexedLine): boolean {
  return line.text.trim().length === 0;
}

function ensureTrailingNewline(content: string): string {
  const normalized = trimTrailingBoundaryLines(content);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function detectDominantEol(content: string): "\n" | "\r\n" {
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}
