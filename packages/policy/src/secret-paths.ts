// epic §9a — LOCKED, case-insensitive secret-path denylist. Compiled
// once at module load into anchored, case-insensitive regexes. Order
// of `**` before `*` in compileGlob matters: the `**` token must be
// consumed before the single-`*` rule runs.
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
export function compileGlob(glob: string): RegExp {
  let body = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero-or-more leading segments (standard glob
        // semantics), so a root-level secret file (`.env`, `id_rsa`)
        // is denied, not just a directory-prefixed one. A bare `**`
        // not followed by `/` still maps to `.*`.
        if (glob[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (char === "?") {
      body += "[^/]";
    } else if (char === ".") {
      body += "\\.";
    } else {
      body += char;
    }
  }
  return new RegExp(`^${body}$`, "i");
}

export const SECRET_PATH_PATTERNS: readonly RegExp[] = DENYLIST_GLOBS.map(compileGlob);

// Lower-case and unify `/` and `\` separators so a Windows-style path
// cannot bypass a `**/.ssh/**` rule. No filesystem access — gate 2
// (output-filter) owns symlink/structural resolution (epic §8a).
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
