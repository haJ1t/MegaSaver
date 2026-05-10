import { CoreRegistryError } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { readTestEnv } from "./shared.js";

export type RunSessionEndInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runSessionEnd(input: RunSessionEndInput): Promise<0 | 1> {
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
    const existing = registry.getSession(id);
    if (!existing) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (existing.endedAt !== null) {
      const cli = sessionAlreadyEndedMessage(id, existing.endedAt);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    // Same inline default as runSessionCreate; if a third call site lands,
    // extract a shared readNow() helper instead of duplicating again.
    const endedAt = (input.now ?? (() => new Date().toISOString()))();
    let ended;
    try {
      ended = registry.endSession(id, { endedAt });
    } catch (err) {
      if (err instanceof CoreRegistryError && err.code === "session_already_ended") {
        // Race with concurrent process: refresh and format the rich message.
        // Not reachable in unit tests — requires a second process to hold the lock
        // and end the session between our pre-check and the endSession call.
        const refreshed = registry.getSession(id);
        if (!refreshed || refreshed.endedAt === null) {
          // Three-way race: session vanished or was reverted. Fall through to
          // the outer catch with the original error rather than fabricating a
          // timestamp.
          throw err;
        }
        const cli = sessionAlreadyEndedMessage(id, refreshed.endedAt);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      throw err;
    }
    input.stdout(input.json ? JSON.stringify(ended) : id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session", id });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionEndCommand = defineCommand({
  meta: { name: "end", description: "Mark a session as ended." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const nowEnv = readTestEnv("MEGA_TEST_NOW");
    const code = await runSessionEnd({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
