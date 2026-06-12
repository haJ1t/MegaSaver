import { rankApplicableRules } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { formatRankedRuleLine, toStringArray } from "./shared.js";

export type RunRulesApplyInput = {
  projectName: string;
  taskFlag?: string | undefined;
  filesFlags?: unknown;
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

export async function runRulesApply(input: RunRulesApplyInput): Promise<0 | 1> {
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
    const files = toStringArray(input.filesFlags);
    const ranked = rankApplicableRules(registry.listProjectRules(project.id), {
      ...(input.taskFlag !== undefined ? { task: input.taskFlag } : {}),
      files,
    });
    // Surface similar past failures as warnings when a task is given.
    if (input.taskFlag !== undefined) {
      for (const s of registry.searchFailedAttempts(project.id, {
        text: input.taskFlag,
        limit: 3,
      })) {
        input.stderr(`warning: similar previous failure ${s.id}: ${s.failedStep}`);
      }
    }
    if (input.json) {
      input.stdout(JSON.stringify(ranked));
    } else {
      for (const r of ranked) input.stdout(formatRankedRuleLine(r));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const rulesApplyCommand = defineCommand({
  meta: { name: "apply", description: "Show project rules applicable to a task/files." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to match." },
    files: { type: "string", description: "File path (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runRulesApply({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : undefined,
      filesFlags: args.files,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
