import { type PathMatcher, compileGlobMatcher } from "./glob-matcher.js";

export type { PathMatcher } from "./glob-matcher.js";

// epic §9a — LOCKED, case-insensitive secret-path denylist. Compiled
// once at module load into anchored PathMatchers. Order of `**` before
// `*` in the tokenizer matters: the `**` token must be consumed before
// the single-`*` rule runs.
export const DENYLIST_GLOBS: readonly string[] = [
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
  // Credential files whose CONTENTS already have output-side detectors
  // (netrc_password, npm_token, pypi_token, url_basic_auth). Without the
  // path denial the redactor was the only line of defence: an agent could
  // read the file directly and the detectors only caught what leaked into
  // tool output afterwards. Detectors are the second line, not the first.
  // `.npmrc` is deliberately ABSENT. The credential case is the `_authToken`
  // line in the USER-level `~/.npmrc`; a project `.npmrc` is pnpm settings —
  // this repo's own is four lines of `auto-install-peers` and friends. Denying
  // it blinds the agent to ordinary config with no appeal, because there is no
  // field to un-deny a baseline path (evaluate-path-read I1). The `npm_token`
  // detector covers the credential if it ever reaches tool output.
  "**/.netrc",
  "**/_netrc",
  "**/.pypirc",
  "**/.git-credentials",
  // Home credential stores (spec 2026-07-25 §3a). resolveSafeReadPath admits
  // the whole home directory as a sandbox root, so this table is the only
  // thing between an agent and these files.
  // All FILE-level, never directory-level, and the discriminator is: does this
  // exact filename ever carry ordinary, non-credential config? If it does, it
  // belongs to the redactor, not here — a baseline denial has no un-deny field
  // (evaluate-path-read I1), so `**/.kube/**` would permanently blind the agent
  // to `.kube/cache`, `**/.docker/**` to `daemon.json` and contexts, and
  // `**/.config/**` to essentially everything.
  // `pgpass.conf` is the Windows spelling (`%APPDATA%\postgresql\pgpass.conf`);
  // normalizePath already folds `\` to `/`. It is the one glob without a
  // leading dot, so it can match a project file of that name — that file is a
  // pgpass file wherever it lives, and the denial is correct there too.
  "**/.pgpass",
  "**/pgpass.conf",
  "**/.docker/config.json",
  "**/.kube/config",
  "**/.config/gh/hosts.yml",
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
