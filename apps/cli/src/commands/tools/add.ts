import {
  type ToolDefinitionInput,
  toolCategorySchema,
  toolDefinitionInputSchema,
  toolRiskSchema,
} from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunToolsAddInput = {
  projectName: string;
  nameFlag: string;
  descriptionFlag: string;
  categoryFlag: string;
  riskFlag: string;
  keywordFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

const CATEGORY_HINT = toolCategorySchema.options.join(" | ");
const RISK_HINT = toolRiskSchema.options.join(" | ");

export async function runToolsAdd(input: RunToolsAddInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
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
  // Closed-enum validation at the boundary (Phase 5/6 lesson): a clean message,
  // never a raw zod dump, for a bad --category / --risk.
  const category = toolCategorySchema.safeParse(input.categoryFlag);
  if (!category.success) {
    input.stderr(`error: invalid category "${input.categoryFlag}" (${CATEGORY_HINT})`);
    return 1;
  }
  const risk = toolRiskSchema.safeParse(input.riskFlag);
  if (!risk.success) {
    input.stderr(`error: invalid risk "${input.riskFlag}" (${RISK_HINT})`);
    return 1;
  }
  let name: string;
  try {
    name = titleSchema.parse(input.nameFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const toolInput = toolDefinitionInputSchema.safeParse({
    name,
    description: input.descriptionFlag,
    category: category.data,
    risk: risk.data,
    keywords: toStringArray(input.keywordFlags),
  } satisfies Partial<ToolDefinitionInput>);
  if (!toolInput.success) {
    input.stderr(`error: invalid tool definition: ${toolInput.error.message}`);
    return 1;
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
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const fixed = readTestEnv("MEGA_TEST_TOOL_DEFINITION_ID");
    const created = registry.createToolDefinition(project.id, toolInput.data, {
      now: () => readTestEnv("MEGA_TEST_NOW") ?? now(),
      newId: () => fixed ?? newId(),
    });
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsAddCommand = defineCommand({
  meta: { name: "add", description: "Register a tool definition." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    name: { type: "string", required: true, description: "Tool name." },
    description: { type: "string", required: true, description: "What the tool does." },
    category: {
      type: "string",
      required: true,
      description:
        "filesystem | search | git | test | package | database | deploy | browser | dangerous.",
    },
    risk: { type: "string", required: true, description: "safe | medium | dangerous." },
    keyword: { type: "string", description: "Retrieval keyword (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsAdd({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      nameFlag: typeof args.name === "string" ? args.name : "",
      descriptionFlag: typeof args.description === "string" ? args.description : "",
      categoryFlag: typeof args.category === "string" ? args.category : "",
      riskFlag: typeof args.risk === "string" ? args.risk : "",
      keywordFlags: args.keyword,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
