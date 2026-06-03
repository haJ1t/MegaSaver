import { z } from "zod";
import { compileGlob } from "./secret-paths.js";

// Tighten-only project permissions (permissions-yaml §2). EVERY key adds
// denials; there is no `allow:` key and no field that subtracts from a
// baseline list, so by construction no input can re-allow a
// DANGEROUS_PATTERNS hit, add to ALLOWED_COMMANDS, or un-deny a
// SECRET_PATH_PATTERNS entry (I1 — enforced by the type, not a runtime check).
const globs = z.array(z.string().min(1)).readonly();

export const projectPermissionsSchema = z
  .object({
    deny: z
      .object({
        read: globs.default([]),
        write: globs.default([]),
        commands: z.array(z.string().min(1)).readonly().default([]),
      })
      .strict()
      .default({ read: [], write: [], commands: [] }),
  })
  // .strict() is load-bearing: a typo or an `allow:` attempt is a parse
  // failure, never a silent ignore — fail-closed (I3, §3.1).
  .strict();

// The COMPILED form (no per-call regex compilation in the hot path). Globs
// are compiled to anchored, case-insensitive RegExps by the same engine as
// SECRET_PATH_PATTERNS; deny.commands stay verbatim for the exact-string
// ALLOWED_COMMANDS-style check (permissions-yaml §2).
export type ProjectPermissions = {
  denyReadPatterns: readonly RegExp[];
  denyWritePatterns: readonly RegExp[];
  denyCommands: readonly string[];
};

// Typed failure signal for a present-but-malformed permissions file. Thrown
// here on bad shape; re-thrown by the context-gate loader wrapping fs/yaml
// errors. The orchestrator maps it to the policy_load_failed deny code — the
// gate NEVER silently opens on a broken file (I3).
export class PolicyLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PolicyLoadError";
  }
}

// PURE: takes an ALREADY-PARSED plain object (no fs, no yaml). Validates with
// the .strict() schema, then compiles globs to the resolved ProjectPermissions.
export function parseProjectPermissions(raw: unknown): ProjectPermissions {
  const result = projectPermissionsSchema.safeParse(raw);
  if (!result.success) {
    throw new PolicyLoadError("invalid project permissions", { cause: result.error });
  }
  const { deny } = result.data;
  return {
    denyReadPatterns: deny.read.map(compileGlob),
    denyWritePatterns: deny.write.map(compileGlob),
    denyCommands: deny.commands,
  };
}
