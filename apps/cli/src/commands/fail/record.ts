import { type FailedAttempt, failedAttemptSchema } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunFailRecordInput = {
  projectName: string;
  taskFlag: string;
  failedStepFlag: string;
  sessionFlag?: string | undefined;
  errorFlag?: string | undefined;
  causeFlag?: string | undefined;
  fileFlags?: unknown;
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

export async function runFailRecord(input: RunFailRecordInput): Promise<0 | 1> {
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

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse> | null = null;
  if (input.sessionFlag !== undefined) {
    try {
      parsedSessionId = sessionIdSchema.parse(input.sessionFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
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

    // Warn before recording when a similar prior failure exists (roadmap exit criterion).
    const similar = registry.searchFailedAttempts(project.id, { text: input.taskFlag, limit: 3 });
    for (const s of similar) {
      input.stderr(`warning: similar previous failure ${s.id}: ${s.failedStep}`);
    }

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_FAILED_ATTEMPT_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const relatedFiles = toStringArray(input.fileFlags);

    const attempt: FailedAttempt = failedAttemptSchema.parse({
      id,
      projectId: project.id,
      sessionId: parsedSessionId,
      task: input.taskFlag,
      failedStep: input.failedStepFlag,
      relatedFiles,
      convertedToRule: false,
      createdAt,
      ...(input.errorFlag !== undefined ? { errorOutput: input.errorFlag } : {}),
      ...(input.causeFlag !== undefined ? { suspectedCause: input.causeFlag } : {}),
    });

    const created = registry.createFailedAttempt(attempt);
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const failRecordCommand = defineCommand({
  meta: { name: "record", description: "Record a failed attempt on a project." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name (must exist)." },
    task: { type: "string", required: true, description: "What was being attempted." },
    "failed-step": { type: "string", required: true, description: "The step that failed." },
    session: { type: "string", description: "Session id (UUID)." },
    error: { type: "string", description: "Error output." },
    cause: { type: "string", description: "Suspected cause." },
    file: { type: "string", description: "Related file path (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runFailRecord({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      taskFlag: typeof args.task === "string" ? args.task : "",
      failedStepFlag:
        typeof args["failed-step"] === "string" ? (args["failed-step"] as string) : "",
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      errorFlag: typeof args.error === "string" ? args.error : undefined,
      causeFlag: typeof args.cause === "string" ? args.cause : undefined,
      fileFlags: args.file,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
