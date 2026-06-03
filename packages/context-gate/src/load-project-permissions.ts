import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PolicyLoadError, type ProjectPermissions, parseProjectPermissions } from "@megasaver/policy";
import { parse as parseYaml } from "yaml";

// IO half of the .megasaver/permissions.yaml feature (permissions-yaml §4.1).
// Reads <projectRoot>/.megasaver/permissions.yaml synchronously (runs once up
// front, like originPid) and delegates the security-critical validation to the
// pure policy.parseProjectPermissions. The fs read + yaml.parse (and the yaml
// dep) live HERE, in the IO layer, so policy stays pure and fs-free.
//
// Fail-closed (I3): only an ABSENT file (ENOENT) is null — absence is not a
// denial. Every other failure mode (non-ENOENT fs error, YAML syntax error,
// schema violation) becomes a single typed PolicyLoadError the caller maps to
// the policy_load_failed deny code. The loader NEVER returns null on a broken
// file, so the gate cannot silently open.
//
// yaml.parse is safe-by-default — no custom tags / no code-exec on parse. Do
// NOT pass any custom-tag or code-exec parse option (permissions-yaml §6).
export function loadProjectPermissions(projectRoot: string): ProjectPermissions | null {
  const file = join(projectRoot, ".megasaver", "permissions.yaml");

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw new PolicyLoadError(`failed to read ${file}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    throw new PolicyLoadError(`failed to parse ${file}`, { cause: err });
  }

  // An empty / whitespace / comment-only document parses to null (yaml's empty
  // doc). A present-but-empty file means "no extra denials" — equivalent to
  // `deny: {}` — so normalize a null/undefined document to an empty object
  // before the pure parser. This is NOT a loosening: empty ⇒ baseline only, the
  // same denial effect as an absent file. Any non-empty non-object document
  // (a string, number, or sequence) falls through to the .strict() parser and
  // fails closed.
  const raw = parsed === undefined || parsed === null ? {} : parsed;

  // parseProjectPermissions throws PolicyLoadError on a bad shape; let it
  // propagate unwrapped — it is already the typed fail-closed signal.
  return parseProjectPermissions(raw);
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
