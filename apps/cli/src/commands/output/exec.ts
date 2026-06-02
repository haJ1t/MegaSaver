import { type RunOutputExecResult, runOutputExecCommand } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  commandDeniedMessage,
  commandFailedMessage,
  intentRequiredMessage,
  mapErrorToCliMessage,
  sessionNotFoundMessage,
  storeWriteFailedMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";

// Defaults locked in spec §2; the flags override them.
const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_MAX_BYTES = 20_000_000;

export type RunOutputExecInput = {
  sessionId: string;
  intentFlag: string | undefined;
  command: string;
  args: readonly string[];
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  // Computed by the defineCommand wrapper: the inherited MEGASAVER_ORIGIN_PID or
  // String(process.pid) when this is the root MegaSaver process (spec §3.3).
  originPid: string;
  timeoutSec?: number;
  maxBytes?: number;
  // Injectables (testability; mirrors the now/newId convention). spawn is
  // threaded straight through to the core orchestrator so unit tests never
  // start a real process.
  spawn?: Parameters<typeof runOutputExecCommand>[0]["spawn"];
  now?: () => string;
  newId?: () => string;
};

// Thin adapter: store resolve → sessionId parse → intent check → call the core
// orchestrator → map its typed result to text/JSON + an exit code. NO spawn,
// policy, filter, or store logic lives here (it is all in @megasaver/core).
// Returns the child-mirrored exit code on a clean run, 1 for expected MegaSaver
// errors / forced termination, 2 for an unexpected throw (spec §6).
export async function runOutputExec(input: RunOutputExecInput): Promise<number> {
  try {
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

    const { registry } = await ensureStoreReady(rootDir);
    const outcome: RunOutputExecResult = await runOutputExecCommand({
      registry,
      storeRoot: rootDir,
      sessionId,
      command: input.command,
      args: input.args,
      intent,
      originPid: input.originPid,
      timeoutMs: (input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1_000,
      maxBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
      ...(input.spawn !== undefined ? { spawn: input.spawn } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.newId !== undefined ? { newId: input.newId } : {}),
    });

    if (!outcome.ok) {
      const cli = (() => {
        switch (outcome.reason) {
          case "session_not_found":
            return sessionNotFoundMessage(input.sessionId);
          case "command_denied":
            return commandDeniedMessage(outcome.code);
          case "command_failed":
            return commandFailedMessage(outcome.detail);
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
      let line = `Ran ${renderCommand(input)} for ${input.sessionId} (${result.returnedBytes} B kept, ${result.bytesSaved} B saved, ${pct}%)`;
      if (result.chunkSetId !== undefined) line += ` chunkSetId=${result.chunkSetId}`;
      input.stdout(line);
      if (result.summary.length > 0) input.stdout(result.summary);
    }

    // Forced termination (timeout / max-bytes) is a MegaSaver-side failure: the
    // partial output was still written, but the run is exit 1 (spec §6).
    if (result.terminated !== undefined) return 1;
    // Otherwise mirror the child's exit code so CI/scripts see the real result.
    // A non-zero child also gets a one-line note on stderr while the success
    // stdout/JSON is STILL written (this is NOT a MegaSaver failure path).
    const childCode = result.childExitCode ?? 0;
    if (childCode !== 0) input.stderr(`note: command exited ${childCode}`);
    return childCode;
  } catch (err) {
    // Unexpected throw → exit 2 so CRITICAL failures are distinguishable from
    // expected denials in supervision logs (spec §6).
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`error: unexpected failure: ${message}`);
    return 2;
  }
}

function renderCommand(input: { command: string; args: readonly string[] }): string {
  return [input.command, ...input.args].join(" ").trim();
}

export const outputExecCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Run a policy-gated command and filter its combined output.",
  },
  args: {
    sessionId: { type: "positional", required: true, description: "Session id (UUID)." },
    intent: { type: "string", description: "What you need from the output (required)." },
    store: { type: "string", description: "Override store directory." },
    timeout: { type: "string", description: "Max child wall-clock seconds (default 300)." },
    "max-bytes": { type: "string", description: "Max bytes of child output captured." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    // Everything after `--` lands in the positional rest: the command then its
    // args (spec §2). An empty command falls through to the policy gate, which
    // is the single arbiter of command validity (command_not_allowed).
    const rest = (args._ ?? []).map(String);
    const command = rest[0] ?? "";
    const commandArgs = rest.slice(1);

    // §3.3 env-marker: inherit the parent's marker, else this process is root.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const inherited = process.env["MEGASAVER_ORIGIN_PID"];
    const originPid = inherited && inherited !== "" ? inherited : String(process.pid);

    const timeoutSec = typeof args.timeout === "string" ? Number(args.timeout) : undefined;
    const maxBytesArg =
      typeof args["max-bytes"] === "string" ? Number(args["max-bytes"]) : undefined;

    const code = await runOutputExec({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      intentFlag: typeof args.intent === "string" ? args.intent : undefined,
      command,
      args: commandArgs,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      originPid,
      ...(timeoutSec !== undefined && Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
      ...(maxBytesArg !== undefined && Number.isFinite(maxBytesArg) ? { maxBytes: maxBytesArg } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
