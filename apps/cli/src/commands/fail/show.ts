import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { failedAttemptIdSchema, formatFailureShow } from "./shared.js";

export type RunFailShowInput = {
  idFlag: string;
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

export async function runFailShow(input: RunFailShowInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let id: ReturnType<typeof failedAttemptIdSchema.parse>;
  try {
    id = failedAttemptIdSchema.parse(input.idFlag);
  } catch {
    input.stderr(`error: invalid failed attempt id "${input.idFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const found = registry.getFailedAttempt(id);
    if (!found) {
      input.stderr("error: failed attempt not found");
      return 1;
    }
    if (input.json) {
      input.stdout(JSON.stringify(found));
    } else {
      for (const line of formatFailureShow(found)) input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const failShowCommand = defineCommand({
  meta: { name: "show", description: "Show a failed attempt by id." },
  args: {
    id: { type: "positional", required: true, description: "Failed attempt id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runFailShow({
      idFlag: typeof args.id === "string" ? args.id : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
