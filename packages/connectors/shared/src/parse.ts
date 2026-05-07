import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { ConnectorError } from "./errors.js";

export interface ParsedBlock {
  before: string;
  block: string | null;
  after: string;
}

interface IndexedLine {
  text: string;
  raw: string;
}

export function parseBlock(content: string): ParsedBlock {
  const lines = splitIndexedLines(content);
  const starts = sentinelIndexes(lines, MEGA_SAVER_BLOCK_START);
  const ends = sentinelIndexes(lines, MEGA_SAVER_BLOCK_END);

  if (starts.length === 0 && ends.length === 0) {
    return { before: content, block: null, after: "" };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    throwBlockConflict();
  }

  const startIndex = starts[0] as number;
  const endIndex = ends[0] as number;
  if (endIndex < startIndex) {
    throwBlockConflict();
  }

  return {
    before: lines
      .slice(0, startIndex)
      .map((l) => l.raw)
      .join(""),
    block: lines
      .slice(startIndex, endIndex + 1)
      .map((l) => l.raw)
      .join(""),
    after: lines
      .slice(endIndex + 1)
      .map((l) => l.raw)
      .join(""),
  };
}

export function splitIndexedLines(content: string): IndexedLine[] {
  if (content.length === 0) return [];
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

export function sentinelIndexes(lines: IndexedLine[], sentinel: string): number[] {
  return lines.flatMap((line, index) => (line.text === sentinel ? [index] : []));
}

function throwBlockConflict(): never {
  throw new ConnectorError(
    "block_conflict",
    "File contains conflicting Mega Saver managed block sentinels.",
  );
}

export type { IndexedLine };
