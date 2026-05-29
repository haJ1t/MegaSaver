import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  fileReadFailedMessage,
  fileRequiredMessage,
  intentRequiredMessage,
  mapErrorToCliMessage,
  pathDeniedMessage,
  pathUnsafeMessage,
  sessionNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import {
  defaultNewId,
  defaultNow,
  persistChunkSet,
  readAndFilter,
  resolveEffectiveSettings,
  runTwoGates,
} from "./shared.js";

export type RunOutputFilterInput = {
  sessionId: string;
  intentFlag: string | undefined;
  fileFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
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
  const settings = resolveEffectiveSettings(registry, sessionId);
  if (settings === null) {
    const cli = sessionNotFoundMessage(input.sessionId);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const gate = runTwoGates({
    path,
    projectId: settings.projectId,
    projectRoot: settings.projectRoot,
  });
  if (!gate.ok) {
    const cli =
      gate.code === "path_denied"
        ? pathDeniedMessage(gate.reason)
        : pathUnsafeMessage(gate.message);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const filtered = await readAndFilter({
    absolute: gate.absolute,
    path,
    intent,
    mode: settings.mode,
    maxReturnedBytes: settings.maxReturnedBytes,
  });
  if (!filtered.ok) {
    const cli = fileReadFailedMessage(filtered.message);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const result = { ...filtered.result };
  if (settings.storeRawOutput) {
    const chunkSetId = (input.newId ?? defaultNewId)();
    await persistChunkSet({
      storeRoot: rootDir,
      chunkSetId,
      sessionId,
      projectId: settings.projectId,
      createdAt: (input.now ?? defaultNow)(),
      path,
      result: filtered.result,
    });
    result.chunkSetId = chunkSetId;
  }

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
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
