import { type PathMatcher, compileGlob } from "@megasaver/policy";
import type { FenceEntry, FenceFile } from "./fence-file.js";

export function normalizeFencePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export type CompiledFence = {
  allow: readonly PathMatcher[];
  entries: ReadonlyArray<{ entry: FenceEntry; matcher: PathMatcher }>;
};

export function compileFence(file: FenceFile): CompiledFence {
  const allow = file.allow.map((g) => compileGlob(normalizeFencePath(g)));
  const entries = file.entries.map((entry) => ({
    entry,
    matcher: compileGlob(normalizeFencePath(entry.path)),
  }));
  return { allow, entries };
}

export type FenceVerdict = { verdict: "allowed" } | { verdict: "warn" | "deny"; entry: FenceEntry };

export function evaluateFenceWrite(input: {
  compiled: CompiledFence;
  relPath: string;
}): FenceVerdict {
  const normalized = normalizeFencePath(input.relPath);
  for (const allowMatcher of input.compiled.allow) {
    if (allowMatcher.test(normalized)) {
      return { verdict: "allowed" };
    }
  }

  for (const { entry, matcher } of input.compiled.entries) {
    if (matcher.test(normalized)) {
      return { verdict: entry.mode ?? "warn", entry };
    }
  }

  return { verdict: "allowed" };
}
