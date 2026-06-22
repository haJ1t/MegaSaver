import { spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  type AgentLauncher,
  type LaunchHandle,
  type LaunchInput,
  LauncherError,
  type LauncherEvent,
  type LauncherPermissionMode,
} from "@megasaver/connectors-shared";

const PERMISSION_MODE_FLAG: Record<LauncherPermissionMode, string> = {
  plan: "plan",
  acceptEdits: "acceptEdits",
  full: "bypassPermissions",
};

export function buildClaudeArgs(input: LaunchInput): string[] {
  const hasNew = input.sessionId !== undefined;
  const hasResume = input.resumeSessionId !== undefined;
  if (hasNew === hasResume) {
    throw new LauncherError(
      "invalid_session_config",
      "Provide exactly one of sessionId or resumeSessionId.",
    );
  }

  const args = [
    "-p",
    input.instruction,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--permission-mode",
    PERMISSION_MODE_FLAG[input.permissionMode],
  ];

  if (input.allowedTools.length > 0) {
    args.push("--allowedTools", ...input.allowedTools);
  }
  if (input.persona !== undefined) {
    args.push("--append-system-prompt", input.persona);
  }
  if (input.resumeSessionId !== undefined) {
    args.push("--resume", input.resumeSessionId);
  } else if (input.sessionId !== undefined) {
    args.push("--session-id", input.sessionId);
  }

  return args;
}

export interface SpawnedChild {
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => SpawnedChild;

// ChildProcess.on() returns `this`; SpawnedChild.on() returns void — structurally
// incompatible despite runtime compatibility, so the cast is safe and minimal.
const defaultSpawn: SpawnFn = (command, args, options) =>
  nodeSpawn(command, [...args], options) as unknown as SpawnedChild;

export function createClaudeCodeLauncher(options: { spawn?: SpawnFn } = {}): AgentLauncher {
  const spawn = options.spawn ?? defaultSpawn;

  return {
    kind: "claude-code",
    launch(input): LaunchHandle {
      const args = buildClaudeArgs(input); // throws on bad session config before spawning
      // buildClaudeArgs guarantees exactly one id is set.
      const sessionId = (input.resumeSessionId ?? input.sessionId) as string;

      const eventCbs: ((event: LauncherEvent) => void)[] = [];
      const exitCbs: ((result: { code: number | null }) => void)[] = [];
      let exited = false;
      let exitResult: { code: number | null } | undefined;
      const emitEvent = (event: LauncherEvent) => {
        for (const cb of eventCbs) cb(event);
      };
      const emitExit = (result: { code: number | null }) => {
        if (exited) return;
        exited = true;
        exitResult = result;
        for (const cb of exitCbs) cb(result);
      };

      const child = spawn("claude", args, { cwd: input.workdir });

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");

      let buffer = "";
      const emitLine = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        try {
          emitEvent({ kind: "stream", payload: JSON.parse(trimmed) });
        } catch {
          // Non-JSON line (verbose noise) — skip.
        }
      };

      child.stdout?.on("data", (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) emitLine(line);
      });
      child.stderr?.on("data", (chunk: string | Buffer) => {
        emitEvent({
          kind: "stderr",
          text: typeof chunk === "string" ? chunk : stderrDecoder.write(chunk),
        });
      });
      child.on("error", (error) => {
        emitEvent({ kind: "stderr", text: error.message });
        emitExit({ code: null });
      });
      child.on("close", (code) => {
        buffer += stdoutDecoder.end();
        if (buffer.trim().length > 0) emitLine(buffer);
        buffer = "";
        emitExit({ code });
      });

      return {
        sessionId,
        onEvent(cb) {
          eventCbs.push(cb);
        },
        onExit(cb) {
          if (exited && exitResult !== undefined) {
            cb(exitResult);
          } else {
            exitCbs.push(cb);
          }
        },
        cancel(signal) {
          child.kill(signal ?? "SIGTERM");
        },
      };
    },
  };
}
