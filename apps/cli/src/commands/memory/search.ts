import {
  type MemorySearchQuery,
  memoryConfidenceSchema,
  memoryScopeSchema,
  memoryTypeSchema,
} from "@megasaver/core";
import { defineCommand } from "citty";
import {
  invalidConfidenceMessage,
  invalidScopeMessage,
  invalidTypeMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatMemorySearchLine } from "./shared.js";

export type RunMemorySearchInput = {
  projectName: string;
  queryFlag: string | undefined;
  typeFlag: string | undefined;
  confidenceFlag: string | undefined;
  scopeFlag: string | undefined;
  includeStale: boolean;
  allFlag?: boolean;
  limitFlag: number | undefined;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemorySearch(input: RunMemorySearchInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const query: MemorySearchQuery = {
    includeStale: input.includeStale,
    ...(input.allFlag ? { includeUnapproved: true } : {}),
  };
  if (input.queryFlag !== undefined) query.text = input.queryFlag;
  if (input.limitFlag !== undefined) query.limit = input.limitFlag;
  if (input.typeFlag !== undefined) {
    const result = memoryTypeSchema.safeParse(input.typeFlag);
    if (!result.success) {
      const cli = invalidTypeMessage(input.typeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.type = result.data;
  }
  if (input.confidenceFlag !== undefined) {
    const result = memoryConfidenceSchema.safeParse(input.confidenceFlag);
    if (!result.success) {
      const cli = invalidConfidenceMessage(input.confidenceFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.confidence = result.data;
  }
  if (input.scopeFlag !== undefined) {
    const result = memoryScopeSchema.safeParse(input.scopeFlag);
    if (!result.success) {
      const cli = invalidScopeMessage(input.scopeFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    query.scope = result.data;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const hits = registry.searchMemoryEntries(project.id, query);
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(hits));
    } else {
      for (const entry of hits) input.stdout(formatMemorySearchLine(entry));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memorySearchCommand = defineCommand({
  meta: { name: "search", description: "Search memory entries on a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    query: { type: "positional", required: false, description: "Free-text query." },
    type: {
      type: "string",
      description: `Filter by type (${memoryTypeSchema.options.join(" | ")}).`,
    },
    confidence: {
      type: "string",
      description: `Filter by confidence (${memoryConfidenceSchema.options.join(" | ")}).`,
    },
    scope: {
      type: "string",
      description: `Filter by scope (${memoryScopeSchema.options.join(" | ")}).`,
    },
    "include-stale": { type: "boolean", default: false, description: "Include stale entries." },
    all: {
      type: "boolean",
      default: false,
      description: "Include unapproved (suggested/rejected) entries.",
    },
    limit: { type: "string", description: "Max results (default 20)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const limitRaw = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
    const code = await runMemorySearch({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      queryFlag: typeof args.query === "string" ? args.query : undefined,
      typeFlag: typeof args.type === "string" ? args.type : undefined,
      confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
      scopeFlag: typeof args.scope === "string" ? args.scope : undefined,
      includeStale: args["include-stale"] === true,
      allFlag: args.all === true,
      limitFlag: limitRaw !== undefined && Number.isFinite(limitRaw) ? limitRaw : undefined,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
