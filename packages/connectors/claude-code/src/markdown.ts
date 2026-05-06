import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { type ClaudeCodeContext, assertClaudeCodeContext } from "./context.js";
import { ClaudeCodeConnectorError } from "./errors.js";

export interface ClaudeMdDocument {
  hasManagedBlock: boolean;
  contentBeforeBlock: string;
  managedBlock: string | null;
  contentAfterBlock: string;
}

export interface UpsertMegaSaverBlockInput {
  existingContent: string;
  context: ClaudeCodeContext;
}

interface IndexedLine {
  text: string;
  raw: string;
}

export function renderClaudeCodeContext(input: ClaudeCodeContext): string {
  const context = assertClaudeCodeContext(input);
  const sessionLabel = context.session?.title ?? context.session?.id ?? "none";
  const riskLevel = context.session?.riskLevel ?? "none";

  return [
    MEGA_SAVER_BLOCK_START,
    "# Mega Saver Context",
    "",
    "Agent: claude-code",
    `Project: ${context.project.name} (${context.project.id})`,
    `Session: ${sessionLabel}`,
    `Risk: ${riskLevel}`,
    "",
    "## Memory",
    "",
    ...renderMemoryEntries(context),
    MEGA_SAVER_BLOCK_END,
    "",
  ].join("\n");
}

export function parseClaudeMd(content: string): ClaudeMdDocument {
  const lines = splitIndexedLines(content);
  const starts = sentinelIndexes(lines, MEGA_SAVER_BLOCK_START);
  const ends = sentinelIndexes(lines, MEGA_SAVER_BLOCK_END);

  if (starts.length === 0 && ends.length === 0) {
    return {
      hasManagedBlock: false,
      contentBeforeBlock: content,
      managedBlock: null,
      contentAfterBlock: "",
    };
  }

  if (starts.length !== 1 || ends.length !== 1) {
    throwBlockConflict();
  }

  const startIndex = starts[0] as number | undefined;
  const endIndex = ends[0] as number | undefined;
  if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) {
    throwBlockConflict();
  }

  return {
    hasManagedBlock: true,
    contentBeforeBlock: lines
      .slice(0, startIndex)
      .map((line) => line.raw)
      .join(""),
    managedBlock: lines
      .slice(startIndex, endIndex + 1)
      .map((line) => line.raw)
      .join(""),
    contentAfterBlock: lines
      .slice(endIndex + 1)
      .map((line) => line.raw)
      .join(""),
  };
}

export function upsertMegaSaverBlock(input: UpsertMegaSaverBlockInput): string {
  const block = renderClaudeCodeContext(input.context);
  const parsed = parseClaudeMd(input.existingContent);

  if (parsed.hasManagedBlock) {
    return ensureTrailingNewline(`${parsed.contentBeforeBlock}${block}${parsed.contentAfterBlock}`);
  }

  const humanContent = trimTrailingNewlines(parsed.contentBeforeBlock);
  if (humanContent.length === 0) {
    return block;
  }

  return `${humanContent}\n\n${block}`;
}

export function removeMegaSaverBlock(content: string): string {
  const parsed = parseClaudeMd(content);
  if (!parsed.hasManagedBlock) {
    return content.length === 0 ? "" : ensureTrailingNewline(content);
  }

  const remaining = joinHumanContent(parsed.contentBeforeBlock, parsed.contentAfterBlock);
  if (remaining.trim().length === 0) {
    return "";
  }

  return ensureTrailingNewline(remaining);
}

function renderMemoryEntries(context: ClaudeCodeContext): string[] {
  if (context.memoryEntries.length === 0) {
    return ["- none"];
  }

  return context.memoryEntries.map((entry) => {
    const target = `${entry.scope}:${entry.id}`;
    const [firstLine = "", ...continuationLines] = entry.content.split("\n");
    const renderedContinuation = continuationLines.map((line) => `  ${line}`).join("\n");

    if (renderedContinuation.length === 0) {
      return `- [${target}] ${firstLine}`;
    }

    return `- [${target}] ${firstLine}\n${renderedContinuation}`;
  });
}

function splitIndexedLines(content: string): IndexedLine[] {
  if (content.length === 0) {
    return [];
  }

  return (
    content
      .match(/[^\n]*(?:\n|$)/g)
      ?.filter((line) => line !== "")
      .map((raw) => ({
        raw,
        text: raw.endsWith("\n") ? raw.slice(0, -1).replace(/\r$/, "") : raw,
      })) ?? []
  );
}

function sentinelIndexes(lines: IndexedLine[], sentinel: string): number[] {
  return lines.flatMap((line, index) => (line.text === sentinel ? [index] : []));
}

function throwBlockConflict(): never {
  throw new ClaudeCodeConnectorError(
    "claude_md_block_conflict",
    "CLAUDE.md contains conflicting Mega Saver managed block sentinels.",
  );
}

function trimTrailingNewlines(content: string): string {
  return content.replace(/(?:\r?\n)+$/u, "");
}

function trimLeadingNewlines(content: string): string {
  return content.replace(/^(?:\r?\n)+/u, "");
}

function joinHumanContent(before: string, after: string): string {
  const normalizedBefore = trimTrailingNewlines(before);
  const normalizedAfter = trimLeadingNewlines(after);

  if (normalizedBefore.length === 0) {
    return normalizedAfter;
  }

  if (normalizedAfter.length === 0) {
    return normalizedBefore;
  }

  return `${normalizedBefore}\n\n${normalizedAfter}`;
}

function ensureTrailingNewline(content: string): string {
  return `${trimTrailingNewlines(content)}\n`;
}
