import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatToolLine } from "./shared.js";

export type RunToolsRouteInput = {
  projectName: string;
  taskFlag?: string | undefined;
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

export async function runToolsRoute(input: RunToolsRouteInput): Promise<0 | 1> {
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
    const result = registry.routeToolsForTask(project.id, input.taskFlag);
    if (input.json) {
      input.stdout(JSON.stringify(result));
    } else {
      input.stdout("allowed:");
      for (const t of result.allowedTools) input.stdout(`  ${formatToolLine(t)}`);
      input.stdout("blocked:");
      for (const t of result.blockedTools) input.stdout(`  ${formatToolLine(t)}`);
      input.stdout(`reason: ${result.reason}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const toolsRouteCommand = defineCommand({
  meta: { name: "route", description: "Recommend task-relevant tools; block dangerous ones." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to route for (omit to allow all safe tools)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runToolsRoute({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
