import { type PathMatcher, compileGlobMatcher } from "./glob-matcher.js";

export type { PathMatcher } from "./glob-matcher.js";

// epic §9a — LOCKED, case-insensitive secret-path denylist. Compiled
// once at module load into anchored PathMatchers. Order of `**` before
// `*` in the tokenizer matters: the `**` token must be consumed before
// the single-`*` rule runs.
const DENYLIST_GLOBS: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.gcp/**",
  "**/.azure/**",
  "**/private_keys/**",
  "**/secrets/**",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*.pem",
  "**/*.key",
  "**/credentials.json",
  "**/service-account*.json",
];

// Exported for parse-project-permissions.ts so project deny.read/write
// globs reuse the SAME matcher as SECRET_PATH_PATTERNS — no second glob
// engine, identical `..`/backslash/case semantics (permissions-yaml §4.1, I4).
export function compileGlob(glob: string): PathMatcher {
  return compileGlobMatcher(glob);
}

export const SECRET_PATH_PATTERNS: readonly PathMatcher[] = DENYLIST_GLOBS.map(compileGlob);

// Lower-case and unify `/` and `\` separators so a Windows-style path
// cannot bypass a `**/.ssh/**` rule. No filesystem access — gate 2
// (output-filter) owns symlink/structural resolution (epic §8a).
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
