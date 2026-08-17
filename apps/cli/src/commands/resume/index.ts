import { execFile } from "node:child_process";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { writeResumeCapsule } from "../../hooks/resume-capsule.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { findProjectByCwd } from "../warmup.js";
import { gatherResumeSources, resolveLastResumeTarget, resolveResumeTarget } from "./gather.js";
import { renderResumeCapsule } from "./render.js";

export type RunResumeInput = {
  sessionId: string | undefined;
  last: boolean;
  copy: boolean;
  next: boolean;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now: () => number;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  copyText?: (text: string) => void;
};

function defaultCopyCapsuleText(platform: NodeJS.Platform): (text: string) => void {
  return (text: string) => {
    if (platform !== "darwin") return;
    try {
      const child = execFile("pbcopy");
      child.on("error", () => {});
      child.stdin?.end(text);
    } catch {
      // clipboard is best-effort
    }
  };
}

export async function runResume(input: RunResumeInput): Promise<0 | 1> {
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

  try {
    const { registry } = await ensureStoreReady(rootDir);

    if (input.sessionId === undefined && !input.last) {
      input.stderr("error: pass a session id or --last");
      return 1;
    }

    const target =
      input.sessionId !== undefined
        ? await resolveResumeTarget({ storeRoot: rootDir, sessionId: input.sessionId })
        : await resolveLastResumeTarget({ storeRoot: rootDir, cwd: input.cwd });

    if (target === null) {
      input.stderr(`error: session "${input.sessionId ?? "--last"}" not found`);
      return 1;
    }

    const sources = await gatherResumeSources({
      storeRoot: rootDir,
      target,
      nowMs: input.now(),
    });

    if (sources.liveness.verdict === "live") {
      input.stderr(
        `error: session "${target.sessionId}" appears live (mesh presence); resurrection refused`,
      );
      return 1;
    }

    if (sources.liveness.verdict === "recently-active") {
      input.stderr(
        `warning: session "${target.sessionId}" was active in the last 10 min; resuming anyway`,
      );
    }

    const rendered = await renderResumeCapsule({ sources, nowMs: input.now() });

    if (input.next) {
      if (input.platform === "win32") {
        input.stderr("error: --next requires POSIX (task-kickoff persistence)");
        return 1;
      }
      const project = findProjectByCwd(registry.listProjects(), input.cwd);
      if (project === null) {
        input.stderr("error: no registered project for this workspace; run mega project create");
        return 1;
      }
      writeResumeCapsule(rootDir, encodeWorkspaceKey(project.rootPath), {
        version: 1,
        sourceSessionId: target.sessionId,
        text: rendered.text,
        tokenCount: rendered.tokenCount,
        createdAt: input.now(),
      });
      input.stdout(`queued resurrection capsule for the next session in "${project.name}"`);
      return 0;
    }

    if (input.json) {
      input.stdout(
        JSON.stringify({
          sessionId: target.sessionId,
          layout: target.layout,
          lastActivityAt: sources.lastActivityAt,
          liveness: sources.liveness,
          tokenCount: rendered.tokenCount,
          estimated: rendered.estimated,
          text: rendered.text,
        }),
      );
      return 0;
    }

    if (input.copy) {
      try {
        (input.copyText ?? defaultCopyCapsuleText(input.platform))(rendered.text);
      } catch {
        input.stderr("warning: clipboard copy failed; capsule printed below");
      }
    }

    input.stdout(rendered.text);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const resumeCommand = defineCommand({
  meta: {
    name: "resume",
    description: "Rebuild a dead session's working context into a bounded kickoff capsule.",
  },
  args: {
    sessionId: {
      type: "positional",
      required: false,
      description: "Session ID to resurrect.",
    },
    last: {
      type: "boolean",
      description: "Resurrect the most recently active session in this workspace.",
    },
    copy: {
      type: "boolean",
      description: "Copy the capsule text to clipboard (Darwin only).",
    },
    next: {
      type: "boolean",
      description: "Queue the capsule to be delivered to the next session in this workspace.",
    },
    json: {
      type: "boolean",
      description: "Emit structured JSON output.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
  },
  async run({ args }) {
    const code = await runResume({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
      last: Boolean(args.last),
      copy: Boolean(args.copy),
      next: Boolean(args.next),
      json: Boolean(args.json),
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      now: Date.now,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
