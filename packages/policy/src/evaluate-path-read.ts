import type { ProjectId } from "@megasaver/shared";
import type { PolicyDenyCode } from "./deny-code.js";
import { SECRET_PATH_PATTERNS, normalizePath } from "./secret-paths.js";

export type EvaluatePathReadInput = {
  path: string;
  project: ProjectId;
};

export type EvaluatePathReadResult = { allowed: true } | { allowed: false; reason: PolicyDenyCode };

export function evaluatePathRead(input: EvaluatePathReadInput): EvaluatePathReadResult {
  const normalized = normalizePath(input.path);
  for (const pattern of SECRET_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: "secret_path_read" };
    }
  }
  return { allowed: true };
}
