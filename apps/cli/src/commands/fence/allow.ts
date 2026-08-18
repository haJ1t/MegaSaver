import { join } from "node:path";
import {
  appendFenceAllow,
  loadFenceFile,
  locateFenceRoot,
  normalizeFencePath,
} from "@megasaver/fence";
import { withFileLock } from "@megasaver/shared/node";
import { defineCommand } from "citty";

export type RunFenceAllowInput = {
  cwd: string;
  path: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFenceAllow(input: RunFenceAllowInput): Promise<0 | 1> {
  const fenceRoot = locateFenceRoot(input.cwd);
  if (fenceRoot === null) {
    input.stderr("no fence.yaml found — run: mega fence init --write");
    return 1;
  }

  const targetGlob = normalizeFencePath(input.path);
  const lockPath = join(fenceRoot, "fence.yaml.lock");

  let exitCode: 0 | 1 = 0;
  let alreadyAllowed = false;

  try {
    const ran = withFileLock(lockPath, { deadlineMs: 1_000, staleMs: 10_000 }, () => {
      const file = loadFenceFile(fenceRoot);
      if (file === null) {
        input.stderr("no fence.yaml found — run: mega fence init --write");
        exitCode = 1;
        return;
      }

      if (
        file.allow.some(
          (g) => normalizeFencePath(g) === targetGlob || g === input.path || g === targetGlob,
        )
      ) {
        alreadyAllowed = true;
        return;
      }

      appendFenceAllow(fenceRoot, targetGlob);
    });

    if (!ran) {
      input.stderr("failed to acquire lock on fence.yaml.lock");
      return 1;
    }

    if (exitCode !== 0) return exitCode;

    if (alreadyAllowed) {
      input.stdout(`already allowed: ${targetGlob}`);
    } else {
      input.stdout(`allowed: ${targetGlob}`);
    }
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`failed to update allow list: ${message}`);
    return 1;
  }
}

export const fenceAllowCommand = defineCommand({
  meta: {
    name: "allow",
    description: "Allow editing of a fenced path or glob pattern",
  },
  args: {
    path: {
      type: "positional",
      description: "Path or glob pattern to allow",
      required: true,
    },
  },
  async run({ args }) {
    const code = await runFenceAllow({
      cwd: process.cwd(),
      path: String(args.path),
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exit(code);
  },
});
