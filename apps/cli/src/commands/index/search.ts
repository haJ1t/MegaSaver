import {
  type CodeBlock,
  blockTypeSchema,
  readBlocks,
  resolveIndexPaths,
  searchBlocks,
} from "@megasaver/indexer";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { type StoreEnv, formatIndexSearchLine, loadProjectContext } from "./shared.js";

const DEFAULT_LIMIT = 20;

export type RunIndexSearchInput = StoreEnv & {
  projectName: string;
  query: string;
  typeFlag: string | undefined;
  limitFlag: number | undefined;
  jsonFlag: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runIndexSearch(input: RunIndexSearchInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;

  let typeFilter: CodeBlock["blockType"] | undefined;
  if (input.typeFlag !== undefined) {
    const result = blockTypeSchema.safeParse(input.typeFlag);
    if (!result.success) {
      input.stderr(
        `error: invalid type "${input.typeFlag}", expected: ${blockTypeSchema.options.join(" | ")}`,
      );
      return 1;
    }
    typeFilter = result.data;
  }

  try {
    const paths = resolveIndexPaths(ctx.rootDir, ctx.project.id);
    const blocks = readBlocks(paths);
    const hits = searchBlocks(blocks, {
      text: input.query,
      ...(typeFilter !== undefined ? { type: typeFilter } : {}),
      limit: input.limitFlag ?? DEFAULT_LIMIT,
    });

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(hits.map((hit) => ({ ...hit.block, score: hit.score }))));
    } else {
      for (const hit of hits) input.stdout(formatIndexSearchLine(hit.score, hit.block));
    }
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

export const indexSearchCommand = defineCommand({
  meta: { name: "search", description: "Search the semantic index by query." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    query: { type: "positional", required: true, description: "Free-text query." },
    type: {
      type: "string",
      description: `Filter by block type (${blockTypeSchema.options.join(" | ")}).`,
    },
    limit: { type: "string", description: "Max results (default 20)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const limitRaw = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
    const code = await runIndexSearch({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      query: typeof args.query === "string" ? args.query : "",
      typeFlag: typeof args.type === "string" ? args.type : undefined,
      limitFlag: limitRaw !== undefined && Number.isFinite(limitRaw) ? limitRaw : undefined,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
