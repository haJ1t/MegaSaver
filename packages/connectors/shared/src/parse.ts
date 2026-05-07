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
    throwBlockConflict(starts, ends);
  }

  const startIndex = starts[0] as number;
  const endIndex = ends[0] as number;
  if (endIndex < startIndex) {
    throwBlockConflict(starts, ends);
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

function throwBlockConflict(begins: number[], ends: number[]): never {
  const toLines = (indexes: number[]): string => indexes.map((i) => `line ${i + 1}`).join(", ");

  let message: string;
  if (begins.length === 0) {
    const endLines = toLines(ends);
    const count = ends.length;
    const plural = count === 1 ? "sentinel" : "sentinels";
    message = `File contains ${count} end ${plural} at ${endLines} but no begin sentinel.`;
  } else if (ends.length === 0) {
    const beginLines = toLines(begins);
    const count = begins.length;
    const plural = count === 1 ? "sentinel" : "sentinels";
    message = `File contains ${count} begin ${plural} at ${beginLines} but no end sentinel.`;
  } else if (begins.length > 1) {
    const beginLines = toLines(begins);
    message = `File contains ${begins.length} begin sentinels at ${beginLines}; expected exactly 1.`;
  } else if (ends.length > 1) {
    const endLines = toLines(ends);
    message = `File contains ${ends.length} end sentinels at ${endLines}; expected exactly 1.`;
  } else {
    // exactly one of each but end before begin
    message = `File contains end sentinel at line ${(ends[0] as number) + 1} before begin sentinel at line ${(begins[0] as number) + 1}.`;
  }

  throw new ConnectorError("block_conflict", message);
}

export type { IndexedLine };
