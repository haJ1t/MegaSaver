import { type ToolCategory, isBlockedTool } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";

export type RunToolsExplainInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

// must match core's blocked categories in tool-router.ts
const BLOCKED_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "dangerous",
  "deploy",
  "database",
]);

export async function runToolsExplain(input: RunToolsExplainInput): Promise<0 | 1> {
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
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const tools = registry.listToolDefinitions(project.id);
    if (input.json) {
      input.stdout(JSON.stringify(tools.map((t) => ({ ...t, blocked: isBlockedTool(t) }))));
      return 0;
    }
    for (const t of tools) {
      let note: string;
      if (BLOCKED_CATEGORIES.has(t.category)) note = `blocked: category ${t.category}`;
      else if (t.risk === "dangerous") note = "blocked: risk dangerous";
      else note = "routable";
      input.stdout(`${t.name}  category=${t.category}  risk=${t.risk}  -> ${note}`);
    }
    input.stdout("policy: dangerous/deploy/database tools are never routed to a plain task.");
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsExplainCommand = defineCommand({
  meta: {
    name: "explain",
    description: "Explain each tool's category/risk and why it is blocked.",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsExplain({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
