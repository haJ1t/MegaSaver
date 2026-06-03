import type { ProjectId } from "@megasaver/shared";
import type { PolicyDenyCode } from "./deny-code.js";
import type { ProjectPermissions } from "./parse-project-permissions.js";
import { SECRET_PATH_PATTERNS, normalizePath } from "./secret-paths.js";

export type EvaluatePathReadInput = {
  path: string;
  project: ProjectId;
  // Additional, tighten-only project deny.read globs (permissions-yaml §4.2).
  // Optional; absent ⇒ baseline only. It can ONLY add denials — there is no
  // field to un-deny a baseline secret path (I1).
  permissions?: ProjectPermissions;
};

export type EvaluatePathReadResult = { allowed: true } | { allowed: false; reason: PolicyDenyCode };

export function evaluatePathRead(input: EvaluatePathReadInput): EvaluatePathReadResult {
  const normalized = normalizePath(input.path);
  for (const pattern of SECRET_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: "secret_path_read" };
    }
  }

  // Project deny.read globs are ADDITIVE to SECRET_PATH_PATTERNS and matched
  // against the SAME normalized input (I4). This runs only after the baseline
  // loop, so it tightens but never un-denies a baseline secret path (I1/I2).
  if (input.permissions !== undefined) {
    for (const pattern of input.permissions.denyReadPatterns) {
      if (pattern.test(normalized)) {
        return { allowed: false, reason: "secret_path_read" };
      }
    }
  }

  return { allowed: true };
}
