import type { SessionHints } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";

interface FailureSource {
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): { errorOutput: string }[];
}

// The whole redacted errorOutput blob is far too long to ever appear verbatim
// in a LATER chunk, so matching it via chunk.text.includes(blob) is dead. We
// distill each blob into SHORT signatures likely to recur in related output:
// diagnostic/error codes (TS2322, E0308) and source paths (src/auth.ts[:42]).
const ERROR_CODE = /\b[A-Z]{1,5}\d{2,5}\b/g;
const FILE_PATH = /[\w./\\-]*\w+\.[a-zA-Z]{1,5}(?::\d+)?/g;
const MIN_SIGNATURE_LENGTH = 4;
export const MAX_SIGNATURES_PER_SESSION = 12;
// Dot-tokens like README.md, example.com, or a.b are prose/hostnames, not
// actionable failure locations — boosting later chunks on them is noise.
// Only extensions that name code or config files count as signatures.
const CODE_EXTENSIONS = new Set(
  "ts tsx js jsx mjs cjs py go rs java rb c h cpp hpp cs swift kt json yml yaml toml sql sh".split(
    " ",
  ),
);

function hasCodeExtension(token: string): boolean {
  const bare = token.replace(/:\d+$/, "");
  const extension = bare.slice(bare.lastIndexOf(".") + 1).toLowerCase();
  return CODE_EXTENSIONS.has(extension);
}

export function extractFailureSignatures(errorOutput: string): string[] {
  const found = new Set<string>();

  for (const match of errorOutput.matchAll(ERROR_CODE)) {
    if (match[0].length >= MIN_SIGNATURE_LENGTH) found.add(match[0]);
  }
  for (const match of errorOutput.matchAll(FILE_PATH)) {
    const token = match[0];
    if (!hasCodeExtension(token)) continue;
    if (token.length >= MIN_SIGNATURE_LENGTH) found.add(token);
    // A file:line token also matches on its bare-path form in later output.
    const bare = token.replace(/:\d+$/, "");
    if (bare !== token && bare.length >= MIN_SIGNATURE_LENGTH) found.add(bare);
  }

  return [...found].slice(0, MAX_SIGNATURES_PER_SESSION);
}

export function buildSessionHints(
  registry: FailureSource,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionHints {
  const failures = registry.listSessionFailures(projectId, sessionId);
  const signatures = new Set<string>();
  for (const f of failures) {
    for (const sig of extractFailureSignatures(f.errorOutput)) signatures.add(sig);
  }
  return {
    recentFailures: [...signatures].slice(0, MAX_SIGNATURES_PER_SESSION),
  };
}
