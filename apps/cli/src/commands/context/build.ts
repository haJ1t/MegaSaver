import { auditPack } from "@megasaver/context-pruner";
import type { ScoredBlock } from "@megasaver/context-pruner";
import { appendAuditEvent } from "@megasaver/core";
import type { SessionId } from "@megasaver/shared";
import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { type ContextRequest, loadPack, toStringArray } from "./shared.js";

function line(index: number, block: ScoredBlock): string[] {
  return [
    `${index}. ${block.filePath}:${block.startLine}-${block.endLine}  ${block.name ?? "-"}  [${block.blockType}]`,
    `   reasons: ${block.reasons.join(", ")}`,
    `   score: ${block.score.toFixed(2)}`,
  ];
}

export type RunContextBuildInput = ContextRequest & {
  jsonFlag: boolean;
  stdout: (line: string) => void;
  // Optional audit injection — when present, a context_pack_built event is
  // appended best-effort (failure never breaks the build path).
  sessionId?: SessionId;
  now?: () => string;
  newId?: () => string;
};

export async function runContextBuild(input: RunContextBuildInput): Promise<0 | 1> {
  const loaded = await loadPack(input);
  if (!loaded) return 1;
  const { pack, projectId, rootDir } = loaded;

  // Emit a context_pack_built audit event best-effort (spec §6d / Task 11).
  if (input.sessionId !== undefined) {
    try {
      const a = auditPack(pack);
      const now = input.now ?? (() => new Date().toISOString());
      const newId = input.newId ?? (() => crypto.randomUUID().toLowerCase());
      appendAuditEvent({
        store: { root: rootDir },
        event: {
          id: newId(),
          sessionId: input.sessionId,
          projectId,
          createdAt: now(),
          kind: "context_pack_built",
          filesConsidered: a.filesConsidered,
          filesIncluded: a.filesIncluded,
          filesExcluded: a.filesExcluded,
          blocksConsidered: a.blocksConsidered,
          blocksIncluded: a.blocksIncluded,
          blocksExcluded: a.blocksExcluded,
          tokensBefore: a.tokensBefore,
          tokensAfter: a.tokensAfter,
        },
      });
    } catch {
      // Best-effort: emission failure must not break the build path.
    }
  }

  if (input.jsonFlag) {
    input.stdout(JSON.stringify(pack));
    return 0;
  }
  input.stdout(`Task: ${pack.task}`);
  input.stdout("");
  input.stdout("Included:");
  pack.included.forEach((block, i) => {
    for (const l of line(i + 1, block)) input.stdout(l);
  });
  input.stdout("");
  input.stdout("Excluded:");
  pack.excluded.forEach((block, i) => {
    for (const l of line(i + 1, block)) input.stdout(l);
  });
  return 0;
}

// Shared arg schema for all `mega context` subcommands.
export const contextArgs = {
  projectName: { type: "positional", required: true, description: "Project name." },
  task: { type: "string", required: true, description: "Task description to select context for." },
  "changed-file": { type: "string", description: "A changed file path (repeatable)." },
  "failing-test": { type: "string", description: "A failing test file path (repeatable)." },
  limit: { type: "string", description: "Max included blocks (default 8)." },
  "max-tokens": { type: "string", description: "Token budget for the pack." },
  store: { type: "string", description: "Override store directory." },
  json: { type: "boolean", default: false, description: "Emit JSON output." },
} as const;

// biome-ignore lint/suspicious/noExplicitAny: citty args bag
export function contextRequestFromArgs(args: any): Omit<ContextRequest, "stderr"> & {
  jsonFlag: boolean;
} {
  const limit = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
  const maxTokens =
    typeof args["max-tokens"] === "string" ? Number.parseInt(args["max-tokens"], 10) : undefined;
  return {
    ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    projectName: typeof args.projectName === "string" ? args.projectName : "",
    task: typeof args.task === "string" ? args.task : "",
    changedFiles: toStringArray(args["changed-file"]),
    failingTests: toStringArray(args["failing-test"]),
    limitFlag: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    maxTokensFlag: maxTokens !== undefined && Number.isFinite(maxTokens) ? maxTokens : undefined,
    jsonFlag: args.json === true,
  };
}

export const contextBuildCommand = defineCommand({
  meta: { name: "build", description: "Build a task-aware context pack from the index." },
  args: contextArgs,
  async run({ args }) {
    const code = await runContextBuild({
      ...contextRequestFromArgs(args),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
