import { buildPrMemoryComment } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { type StoreEnv, loadProjectContext } from "../index/shared.js";

export type RunGithubPrCommentInput = StoreEnv & {
  projectName: string;
  task: string;
  limitFlag: number | undefined;
  postFlag: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  spawnPost?: (prNumber: string, body: string) => Promise<number>;
};

export async function runGithubPrComment(input: RunGithubPrCommentInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const memories = ctx.registry.searchMemoryEntries(ctx.project.id, {
      ...(input.task.trim().length > 0 ? { text: input.task } : {}),
      scope: "project",
      ...(input.limitFlag !== undefined ? { limit: input.limitFlag } : {}),
    });
    const body = buildPrMemoryComment(memories, {
      projectName: input.projectName,
      ...(input.task.trim().length > 0 ? { task: input.task } : {}),
    });
    if (input.postFlag !== undefined) {
      const post = input.spawnPost ?? defaultSpawnPost;
      const code = await post(input.postFlag, body);
      if (code !== 0) {
        input.stderr("error: gh pr comment failed");
        return 1;
      }
      return 0;
    }
    input.stdout(body);
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

// Untested by design: external binary + network. Injected as `spawnPost` in tests.
async function defaultSpawnPost(prNumber: string, body: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return await new Promise<number>((resolve) => {
    const child = spawn("gh", ["pr", "comment", prNumber, "--body-file", "-"], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.write(body);
    child.stdin.end();
  });
}

export const githubPrCommentCommand = defineCommand({
  meta: { name: "pr-comment", description: "Print a PR comment from approved project memory." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    task: { type: "string", description: "Task text to rank relevant memory by." },
    limit: { type: "string", description: "Max memories to include." },
    post: { type: "string", description: "PR number to post to via gh (best-effort)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const limitRaw = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
    const code = await runGithubPrComment({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      task: typeof args.task === "string" ? args.task : "",
      limitFlag: limitRaw !== undefined && Number.isFinite(limitRaw) ? limitRaw : undefined,
      postFlag: typeof args.post === "string" ? args.post : undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
