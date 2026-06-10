import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { formatShowLines } from "./shared.js";

export type RunSessionShowInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionShow(input: RunSessionShowInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const session = registry.getSession(id);
    if (!session) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    for (const line of formatShowLines(session)) {
      input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionShowCommand = defineCommand({
  meta: { name: "show", description: "Show a session's full details." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionShow({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
