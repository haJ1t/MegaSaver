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
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

// Defaults locked in spec §2; the flags override them.
const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_MAX_BYTES = 20_000_000;

// citty keeps the consumed named positional (sessionId) IN args._ and appends
// every token after `--`, in order: [sessionId, command, ...commandArgs]. So
// the command to run is args._[1] — args._[0] is the sessionId. Reading [0]
// (the prior bug) fed the session UUID to the policy gate, denying every real
// run as command_not_allowed. Exported as a pure unit so the index contract is
// covered without spawning a child process; the existing tests call
// runOutputExec directly and so never exercised this citty-merge extraction.
export function execCommandFromPositionals(positionals: readonly unknown[]): {
  command: string;
  commandArgs: string[];
} {
  const rest = positionals.map(String);
  return { command: rest[1] ?? "", commandArgs: rest.slice(2) };
}

export type RunOutputExecInput = {
  sessionId: string;
  intentFlag: string | undefined;
  command: string;
  args: readonly string[];
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
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
          case "policy_load_failed":
            // policy_load_failed IS a PolicyDenyCode; surface it on the same
            // command_denied line so the CLI and MCP observe the same code. The
            // command was never spawned (fail-closed, I3).
            return commandDeniedMessage("policy_load_failed");
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

    // Forced termination (timeout / max-bytes) is a MegaSaver-side failure path:
    // core still persisted the partial chunkSet to the store, but the run is
    // exit 1 and emits NO success envelope on stdout — machine consumers must
    // never see a success line/JSON for a failed run (spec §6/§7).
    if (result.terminated !== undefined) {
      input.stderr(`error: command_failed: terminated: ${result.terminated}`);
      return 1;
    }

    if (input.json) {
      input.stdout(JSON.stringify({ sessionId: input.sessionId, result }));
    } else {
      const pct = Math.round(result.savingRatio * 100);
      let line = `Ran ${renderCommand(input)} for ${input.sessionId} (${result.returnedBytes} B kept, ${result.bytesSaved} B saved, ${pct}%)`;
      if (result.chunkSetId !== undefined) line += ` chunkSetId=${result.chunkSetId}`;
      input.stdout(line);
      if (result.summary.length > 0) input.stdout(result.summary);
      for (const w of result.warnings ?? []) input.stderr(`warning: ${w}`);
    }

    // Mirror the child's exit code so CI/scripts see the real result.
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
    // Post-`--` command extraction (see execCommandFromPositionals). An empty
    // command falls through to the policy gate (command_not_allowed).
    const { command, commandArgs } = execCommandFromPositionals(args._ ?? []);

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
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
      originPid,
      ...(timeoutSec !== undefined && Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
      ...(maxBytesArg !== undefined && Number.isFinite(maxBytesArg)
        ? { maxBytes: maxBytesArg }
        : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
