import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { OutputFilterError } from "./errors.js";

export type ResolveSafeReadPathInput = {
  path: string;
  projectRoot: string;
};

// `real` is `absolute` with every symlink component resolved. Callers need it
// because `absolute` is lexical: gate 1's secret-path denylist is a pure string
// match, so it must be re-run against the file that will actually be read.
export type ResolvedPath = { absolute: string; real: string };

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function nearestExistingAncestor(absolute: string): string {
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

export function resolveSafeReadPath(input: ResolveSafeReadPathInput): ResolvedPath {
  const roots = [...new Set([input.projectRoot, process.cwd(), homedir()].map((r) => resolve(r)))];

  const absolute = isAbsolute(input.path)
    ? resolve(input.path)
    : resolve(input.projectRoot, input.path);

  const lexicallyContained = roots.some((root) => isContained(root, absolute));
  if (!lexicallyContained) {
    throw new OutputFilterError("path_unsafe", `path escapes sandbox: ${input.path}`);
  }

  const realRoots = roots.map((root) => (existsSync(root) ? realpathSync(root) : root));
  const ancestor = nearestExistingAncestor(absolute);
  const real = resolve(realpathSync(ancestor), relative(ancestor, absolute));
  const realContained = realRoots.some((root) => isContained(root, real));
  if (!realContained) {
    throw new OutputFilterError("path_unsafe", `symlink escapes sandbox: ${input.path}`);
  }

  return { absolute, real };
}
