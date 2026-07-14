import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { runVerify } from "@megasaver/core";
import { checkEntitlement } from "@megasaver/entitlement";
import { type MemoryEntryId, projectIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";

export const MEMORY_VERIFY_UPSELL =
  "Automatic code-truth verification (post-commit hook, sweep pre-pass) is a Mega Saver Pro feature. Activate a key: mega license activate <key>.";

export type RunMemoryVerifyInput = {
  projectId: string;
  changedFlag: boolean;
  quietFlag: boolean;
  jsonFlag: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
  nowMs?: () => number;
  publicKey?: KeyObject | string;
  execGit?: (args: string[], cwd: string) => string;
};

// Must forward `input` to git's stdin: runVerify's batched `cat-file
// --batch-check` feeds `HEAD:<path>` there, and an execGit that drops it makes
// every blob read as missing (ExecGit contract in code-truth.ts). timeout
// mirrors git-delta.ts: a stuck git (index.lock) must not hang the CLI.
const defaultExecGit = (args: string[], cwd: string, input?: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 3000,
    maxBuffer: 10 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });

// Fail-open (hook mode must never break a commit): outside a git repo or on a
// commitless HEAD, an empty scope verifies nothing instead of erroring.
function changedPathsAtHead(
  rootPath: string,
  execGit: (args: string[], cwd: string) => string,
): string[] {
  try {
    return execGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], rootPath)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function sha7(sha: string): string {
  return sha.slice(0, 7);
}

export async function runMemoryVerify(input: RunMemoryVerifyInput): Promise<0 | 1> {
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

  const idResult = projectIdSchema.safeParse(input.projectId);
  if (!idResult.success) {
    input.stderr(`error: invalid project id: ${input.projectId}`);
    return 1;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.getProject(idResult.data);
    if (project === null) {
      const cli = projectNotFoundMessage(input.projectId);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const now = readTestEnv("MEGA_TEST_NOW") ?? (input.now ?? (() => new Date().toISOString()))();
    const execGit = input.execGit ?? defaultExecGit;

    const plan = await runVerify({
      registry,
      projectId: project.id,
      rootPath: project.rootPath,
      now,
      ...(input.changedFlag
        ? { scope: { changedPaths: changedPathsAtHead(project.rootPath, execGit) } }
        : {}),
      execGit,
    });

    const flips = plan.contradicted.length + plan.healed.length;
    const titleOf = (id: MemoryEntryId): string => registry.getMemoryEntry(id)?.title ?? "";

    if (input.jsonFlag) {
      input.stdout(JSON.stringify(plan));
    } else if (!input.quietFlag || flips > 0) {
      input.stdout(
        `${plan.contradicted.length} contradicted, ${plan.healed.length} healed, ` +
          `${plan.verified.length} verified, ${plan.unanchored.length} unanchored, ` +
          `${plan.repointed.length} repointed`,
      );
      for (const row of plan.contradicted) {
        const commit = row.commit === undefined ? "" : ` (commit ${sha7(row.commit)})`;
        input.stdout(`contradicted ${row.id} "${titleOf(row.id)}" ${row.reason}${commit}`);
      }
      for (const id of plan.healed) input.stdout(`healed ${id} "${titleOf(id)}"`);
      for (const row of plan.repointed) {
        input.stdout(`repointed ${row.id} ${row.from} -> ${row.to}`);
      }
    }

    // Organic upsell (spec §8.1): a free verify that finds contradictions
    // names the Pro automation. Disclosure goes to stderr like all CLI notes;
    // stdout stays machine-safe for --json/table consumers.
    if (plan.contradicted.length > 0) {
      const ent = checkEntitlement("code-truth", {
        storeRoot: rootDir,
        now: input.nowMs ?? (() => Date.now()),
        ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
      });
      if (!ent.entitled) input.stderr(MEMORY_VERIFY_UPSELL);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryVerifyCommand = defineCommand({
  meta: {
    name: "verify",
    description: "Verify code anchors against the repo (code-truth). Exit 0 always.",
  },
  args: {
    projectId: { type: "positional", required: true, description: "Project id (UUID)." },
    changed: {
      type: "boolean",
      default: false,
      description: "Scope to paths changed in the last commit (hook mode).",
    },
    quiet: {
      type: "boolean",
      default: false,
      description: "Print only when something contradicted or healed.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryVerify({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectId: typeof args.projectId === "string" ? args.projectId : "",
      changedFlag: args.changed === true,
      quietFlag: args.quiet === true,
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
