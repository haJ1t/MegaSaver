import { type TokenSaverSettings, defaultTokenSaverSettings } from "@megasaver/core";
import { modeToBudget, sessionIdSchema, tokenSaverModeSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { invalidModeMessage, mapErrorToCliMessage, missingModeMessage } from "../../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";

export type RunSessionSaverEnableInput = {
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

export async function runSessionSaverEnable(input: RunSessionSaverEnableInput): Promise<0 | 1> {
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

  if (input.modeFlag === undefined) {
    const cli = missingModeMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedMode: ReturnType<typeof tokenSaverModeSchema.parse>;
  try {
    parsedMode = tokenSaverModeSchema.parse(input.modeFlag);
  } catch {
    const cli = invalidModeMessage(input.modeFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const existing = registry.getSession(parsedSessionId);
    const defaults = defaultTokenSaverSettings(now);
    const settings: TokenSaverSettings = {
      enabled: true,
      mode: parsedMode,
      maxReturnedBytes: modeToBudget(parsedMode),
      storeRawOutput: defaults.storeRawOutput,
      redactSecrets: defaults.redactSecrets,
      autoRepair: defaults.autoRepair,
      createdAt: existing?.tokenSaver?.createdAt ?? now(),
      updatedAt: now(),
    };
    const updated = registry.updateTokenSaver(parsedSessionId, settings);
    if (input.json) {
      input.stdout(JSON.stringify({ sessionId: parsedSessionId, tokenSaver: updated.tokenSaver }));
    } else {
      input.stdout(
        `Mega Saver Mode enabled for ${parsedSessionId} (${settings.mode}; ${settings.maxReturnedBytes} B)`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionSaverEnableCommand = defineCommand({
  meta: { name: "enable", description: "Enable Mega Saver Mode on a session." },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    mode: {
      type: "string",
      description: `Token-saver mode (${tokenSaverModeSchema.options.join(" | ")}).`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionSaverEnable({
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
