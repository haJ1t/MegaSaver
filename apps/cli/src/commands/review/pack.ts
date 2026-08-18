import { type ExecGit, ReviewPackError, buildReviewPack } from "@megasaver/review-pack";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunReviewPackInput = {
  range: string | undefined;
  json: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  execGit?: ExecGit;
  now?: () => string;
  newId?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runReviewPack(input: RunReviewPackInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStorePath(input);
  } catch (err) {
    input.stderr(`error: unable to resolve store path (${String(err)})`);
    return 1;
  }

  let resolveProjectId: ((repoTopLevel: string) => string | undefined) | undefined;
  try {
    const { registry } = await ensureStoreReady(storeRoot);
    resolveProjectId = (top) => registry.listProjects().find((p) => p.rootPath === top)?.id;
  } catch {
    // Degrade to overlay-only receipts
  }

  try {
    const pack = await buildReviewPack({
      repoRoot: input.cwd,
      storeRoot,
      range: input.range,
      ...(resolveProjectId !== undefined ? { resolveProjectId } : {}),
      ...(input.execGit !== undefined ? { execGit: input.execGit } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.newId !== undefined ? { newId: input.newId } : {}),
    });

    if (input.json) {
      input.stdout(JSON.stringify(pack));
    } else {
      input.stdout(pack.digest);
    }
    return 0;
  } catch (err) {
    if (err instanceof ReviewPackError) {
      if (input.json) {
        input.stdout(
          JSON.stringify({
            ok: false,
            reason: err.code,
            message: err.message,
          }),
        );
      } else {
        input.stderr(`error: ${err.message}`);
      }
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (input.json) {
      input.stdout(JSON.stringify({ ok: false, error: message }));
    } else {
      input.stderr(`error: ${message}`);
    }
    return 1;
  }
}

export const reviewPackCommand = defineCommand({
  meta: {
    name: "pack",
    description: "Build an evidence-preserving, secret-redacted review pack for a commit range.",
  },
  args: {
    range: {
      type: "positional",
      required: false,
      description: "Commit range (<base>..<head>), defaults to default-branch..HEAD.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit structured JSON pack.",
    },
    store: {
      type: "string",
      description: "Override store directory.",
    },
  },
  async run({ args }) {
    const storeEnv = readStoreEnv(args.store);
    const exitCode = await runReviewPack({
      range: args.range,
      json: args.json ?? false,
      ...storeEnv,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  },
});
