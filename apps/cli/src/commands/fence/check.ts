import { isAbsolute, relative, resolve } from "node:path";
import { appendFirewallEvent } from "@megasaver/context-gate";
import {
  compileFence,
  evaluateFenceWrite,
  fenceAlternative,
  formatFenceDenyReason,
  formatFenceWarn,
  loadFenceFile,
  locateFenceRoot,
  normalizeFencePath,
} from "@megasaver/fence";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

export type RunFenceCheckInput = {
  cwd: string;
  path: string;
  json: boolean;
  storeFlag?: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runFenceCheck(input: RunFenceCheckInput): Promise<0 | 1> {
  const fenceRoot = locateFenceRoot(input.cwd);
  if (fenceRoot === null) {
    if (input.json) {
      input.stdout(JSON.stringify({ path: input.path, verdict: "allowed" }));
    } else {
      input.stdout(`allowed: ${input.path}`);
    }
    return 0;
  }

  let file: ReturnType<typeof loadFenceFile>;
  try {
    file = loadFenceFile(fenceRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    input.stderr(`fence.yaml is invalid: ${message}`);
    return 1;
  }

  if (file === null) {
    if (input.json) {
      input.stdout(JSON.stringify({ path: input.path, verdict: "allowed" }));
    } else {
      input.stdout(`allowed: ${input.path}`);
    }
    return 0;
  }

  const absPath = isAbsolute(input.path)
    ? input.path
    : resolve(input.cwd, input.path);
  const rawRel = relative(fenceRoot, absPath);

  if (rawRel.startsWith("..") || isAbsolute(rawRel)) {
    if (input.json) {
      input.stdout(JSON.stringify({ path: input.path, verdict: "allowed" }));
    } else {
      input.stdout(`allowed: ${input.path}`);
    }
    return 0;
  }

  const relPath = normalizeFencePath(rawRel);
  const compiled = compileFence(file);
  const verdict = evaluateFenceWrite({ compiled, relPath });

  if (verdict.verdict === "allowed") {
    if (input.json) {
      input.stdout(JSON.stringify({ path: relPath, verdict: "allowed" }));
    } else {
      input.stdout(`allowed: ${relPath}`);
    }
    return 0;
  }

  try {
    const storeRoot = resolveStorePath(readStoreEnv(input.storeFlag));
    appendFirewallEvent(storeRoot, {
      at: new Date().toISOString(),
      kind: verdict.verdict === "deny" ? "fence-deny" : "fence-warn",
      detector: `fence:${verdict.entry.class}`,
      count: 1,
      sourcePath: relPath,
    });
  } catch {}

  if (input.json) {
    input.stdout(
      JSON.stringify({
        path: relPath,
        verdict: verdict.verdict,
        class: verdict.entry.class,
        reason: verdict.entry.reason,
        alternative: fenceAlternative(verdict.entry),
      }),
    );
  } else {
    const text =
      verdict.verdict === "deny"
        ? formatFenceDenyReason(verdict.entry, relPath)
        : formatFenceWarn(verdict.entry, relPath);
    input.stdout(text);
  }

  return 1;
}

export const fenceCheckCommand = defineCommand({
  meta: {
    name: "check",
    description: "Check if a file path is fenced",
  },
  args: {
    path: {
      type: "positional",
      description: "Path to check against fence rules",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Emit JSON output",
      default: false,
    },
    store: {
      type: "string",
      description: "Override MegaSaver store directory",
    },
  },
  async run({ args }) {
    const code = await runFenceCheck({
      cwd: process.cwd(),
      path: String(args.path),
      json: Boolean(args.json),
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      stdout: (l) => console.log(l),
      stderr: (l) => console.error(l),
    });
    if (code !== 0) process.exit(code);
  },
});
