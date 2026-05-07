import type { ConnectorContext } from "./context.js";
import { type IndexedLine, parseBlock, splitIndexedLines } from "./parse.js";
import { renderBlock } from "./render.js";

interface UpsertBlockInput {
  existingContent: string;
  context: ConnectorContext;
}

export function upsertBlock(input: UpsertBlockInput): string {
  const eol = detectDominantEol(input.existingContent);
  const normalized = input.existingContent.replace(/\r\n/g, "\n");

  const block = renderBlock(input.context);
  const parsed = parseBlock(normalized);

  let result: string;
  if (parsed.block !== null) {
    result = joinWithManagedBlock(parsed.before, parsed.after, block);
  } else {
    const humanContent = trimTrailingBoundaryForJoin(parsed.before);
    if (humanContent.length === 0) {
      result = block;
    } else {
      result = `${humanContent}\n\n${block}`;
    }
  }

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

function joinWithManagedBlock(
  before: string,
  after: string,
  newBlock: string,
): string {
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
