import { runOutputPipeline } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  fileReadFailedMessage,
  fileRequiredMessage,
  intentRequiredMessage,
  mapErrorToCliMessage,
  pathDeniedMessage,
  pathUnsafeMessage,
  policyLoadFailedMessage,
  sessionNotFoundMessage,
  storeWriteFailedMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunOutputFilterInput = {
  sessionId: string;
  intentFlag: string | undefined;
  fileFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  now?: () => string;
  newId?: () => string;
};

export async function runOutputFilter(input: RunOutputFilterInput): Promise<0 | 1> {
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

  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.intentFlag === undefined || input.intentFlag === "") {
    const cli = intentRequiredMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const intent = input.intentFlag;

  if (input.fileFlag === undefined || input.fileFlag === "") {
    const cli = fileRequiredMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const path = input.fileFlag;

  const { registry } = await ensureStoreReady(rootDir);
  const outcome = await runOutputPipeline({
    registry,
    storeRoot: rootDir,
    sessionId,
    path,
    intent,
    ...(input.now !== undefined ? { now: input.now } : {}),
    ...(input.newId !== undefined ? { newId: input.newId } : {}),
  });

  if (!outcome.ok) {
    const cli = (() => {
      switch (outcome.reason) {
        case "session_not_found":
          return sessionNotFoundMessage(input.sessionId);
        case "policy_load_failed":
          // A present-but-malformed permissions.yaml; the file was never read
          // (fail-closed, I3).
          return policyLoadFailedMessage(outcome.detail);
        case "path_denied":
          return pathDeniedMessage(outcome.detail);
        case "path_unsafe":
          return pathUnsafeMessage(outcome.detail);
        case "file_read_failed":
          return fileReadFailedMessage(outcome.detail);
        case "store_write_failed":
          return storeWriteFailedMessage(outcome.detail);
      }
    })();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const { result } = outcome;
  if (input.json) {
    input.stdout(JSON.stringify({ sessionId: input.sessionId, result }));
  } else {
    const pct = Math.round(result.savingRatio * 100);
    let line = `Filtered ${path} for ${input.sessionId} (${result.returnedBytes} B kept, ${result.bytesSaved} B saved, ${pct}%)`;
    if (result.chunkSetId !== undefined) line += ` chunkSetId=${result.chunkSetId}`;
    input.stdout(line);
  }
  return 0;
}

export const outputFilterCommand = defineCommand({
  meta: { name: "filter", description: "Filter an existing log file through the pipeline." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    intent: { type: "string", description: "What you need from the output (required)." },
    file: { type: "string", description: "Path to the log file (required)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runOutputFilter({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      intentFlag: typeof args.intent === "string" ? args.intent : undefined,
      fileFlag: typeof args.file === "string" ? args.file : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
