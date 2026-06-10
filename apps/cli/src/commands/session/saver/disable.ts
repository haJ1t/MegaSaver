import { type TokenSaverSettings, defaultTokenSaverSettings } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, unexpectedModeMessage } from "../../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";

export type RunSessionSaverDisableInput = {
  sessionId: string;
  modeFlag: string | undefined;
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
};

export async function runSessionSaverDisable(input: RunSessionSaverDisableInput): Promise<0 | 1> {
  const now = input.now ?? (() => new Date().toISOString());

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

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (input.modeFlag !== undefined) {
    const cli = unexpectedModeMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const existing = registry.getSession(parsedSessionId);
    const base = existing?.tokenSaver ?? defaultTokenSaverSettings(now);
    const settings: TokenSaverSettings = { ...base, enabled: false, updatedAt: now() };
    const updated = registry.updateTokenSaver(parsedSessionId, settings);
    if (input.json) {
      input.stdout(JSON.stringify({ sessionId: parsedSessionId, tokenSaver: updated.tokenSaver }));
    } else {
      input.stdout(`Mega Saver Mode disabled for ${parsedSessionId}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionSaverDisableCommand = defineCommand({
  meta: { name: "disable", description: "Disable Mega Saver Mode on a session." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    mode: { type: "string", description: "Rejected — --mode is only valid on enable." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverDisable({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      modeFlag: typeof args.mode === "string" ? args.mode : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      now: () => new Date().toISOString(),
    });
    if (code !== 0) process.exitCode = code;
  },
});
