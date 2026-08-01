import type { ContextPack } from "@megasaver/context-pruner";
import { type MemoryEntry, isRecallable } from "@megasaver/core";

export const TASK_KICKOFF_TOKEN_CAP = 2_000;
export const TASK_KICKOFF_MAX_MEMORIES = 6;
export const TASK_KICKOFF_MAX_FILES = 12;

export type TaskKickoffPackInput = {
  projectName: string;
  task: string;
  now: string;
  memories: readonly MemoryEntry[];
  contextPack: ContextPack;
  count: (text: string) => Promise<number>;
};

export type TaskKickoffPack = { text: string; tokenCount: number };

function eligibleMemory(memory: MemoryEntry, now: string): boolean {
  return (
    isRecallable(memory, now) &&
    !memory.stale &&
    (memory.lastVerified?.result === "verified" || memory.lastVerified?.result === "healed")
  );
}

function memoryLine(memory: MemoryEntry): string {
  const firstSentence = memory.content.split(/(?<=[.!?])\s/)[0] ?? memory.content;
  return `- [${memory.type}] ${memory.title} — ${firstSentence.slice(0, 160)}`;
}

function candidateLine(candidate: ContextPack["included"][number]): string {
  const name = candidate.name === undefined ? "" : ` ${candidate.name}`;
  return `- ${candidate.filePath}:${candidate.startLine}-${candidate.endLine}${name} (${candidate.reasons[0]})`;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function countText(
  lines: readonly string[],
  count: TaskKickoffPackInput["count"],
): Promise<{ text: string; tokenCount: number } | null> {
  const text = `${lines.join("\n")}\n`;
  try {
    const tokenCount = await count(text);
    if (!Number.isFinite(tokenCount) || tokenCount < 0) return null;
    return { text, tokenCount };
  } catch {
    return null;
  }
}

export async function renderTaskKickoffPack(
  input: TaskKickoffPackInput,
): Promise<TaskKickoffPack | null> {
  const lines = [
    `# Task kickoff — ${input.projectName}`,
    `Task: ${input.task.trim().slice(0, 320)}`,
    "## Verified project memory",
  ];
  let counted = await countText(lines, input.count);
  if (counted === null || counted.tokenCount > TASK_KICKOFF_TOKEN_CAP) return null;

  const memories = input.memories
    .filter((memory) => eligibleMemory(memory, input.now))
    .sort((left, right) => compareOrdinal(left.id, right.id))
    .slice(0, TASK_KICKOFF_MAX_MEMORIES);
  for (const memory of memories) {
    const line = memoryLine(memory);
    const prospective = await countText([...lines, line], input.count);
    const withCandidateHeading = await countText(
      [...lines, line, "## Candidate files"],
      input.count,
    );
    if (prospective === null || withCandidateHeading === null) return null;
    if (
      prospective.tokenCount <= TASK_KICKOFF_TOKEN_CAP &&
      withCandidateHeading.tokenCount <= TASK_KICKOFF_TOKEN_CAP
    ) {
      lines.push(line);
      counted = prospective;
    }
  }

  const candidateHeading = await countText([...lines, "## Candidate files"], input.count);
  if (candidateHeading === null || candidateHeading.tokenCount > TASK_KICKOFF_TOKEN_CAP) {
    return null;
  }
  lines.push("## Candidate files");
  counted = candidateHeading;

  const candidates = input.contextPack.included
    .slice()
    .sort(
      (left, right) =>
        compareOrdinal(left.filePath, right.filePath) ||
        left.startLine - right.startLine ||
        compareOrdinal(left.blockId, right.blockId),
    )
    .slice(0, TASK_KICKOFF_MAX_FILES);
  for (const candidate of candidates) {
    const prospective = await countText([...lines, candidateLine(candidate)], input.count);
    if (prospective === null) return null;
    if (prospective.tokenCount <= TASK_KICKOFF_TOKEN_CAP) {
      lines.push(candidateLine(candidate));
      counted = prospective;
    }
  }

  return counted;
}
