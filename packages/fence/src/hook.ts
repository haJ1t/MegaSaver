import { isAbsolute, relative, resolve } from "node:path";
import { compileFence, evaluateFenceWrite, normalizeFencePath } from "./evaluate.js";
import { type FenceEntry, loadFenceFile, locateFenceRoot } from "./fence-file.js";
import { formatFenceDenyReason, formatFenceWarn } from "./texts.js";

export type FenceHookVerdict =
  | { kind: "none" }
  | {
      kind: "warn" | "deny";
      entry: FenceEntry;
      relPath: string;
      text: string;
    };

// NEVER throws: locate → load → compile → evaluate; any failure (parse error,
// unreadable dir, path outside fence root) → { kind: "none" } (fail-open).
export function evaluateFenceForWrite(input: {
  cwd: string;
  filePath: string;
}): FenceHookVerdict {
  try {
    const fenceRoot = locateFenceRoot(input.cwd);
    if (fenceRoot === null) return { kind: "none" };

    const file = loadFenceFile(fenceRoot);
    if (file === null) return { kind: "none" };

    const absPath = isAbsolute(input.filePath)
      ? input.filePath
      : resolve(input.cwd, input.filePath);

    const rawRel = relative(fenceRoot, absPath);
    if (rawRel.startsWith("..") || isAbsolute(rawRel)) {
      return { kind: "none" };
    }

    const relPath = normalizeFencePath(rawRel);
    const compiled = compileFence(file);
    const verdict = evaluateFenceWrite({ compiled, relPath });

    if (verdict.verdict === "allowed") {
      return { kind: "none" };
    }

    const text =
      verdict.verdict === "deny"
        ? formatFenceDenyReason(verdict.entry, relPath)
        : formatFenceWarn(verdict.entry, relPath);

    return {
      kind: verdict.verdict,
      entry: verdict.entry,
      relPath,
      text,
    };
  } catch {
    return { kind: "none" };
  }
}
