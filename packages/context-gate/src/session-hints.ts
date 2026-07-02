import type { SessionHints } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import type { MemoryEntryView, ProjectRuleView } from "./registry-port.js";

interface HintSource {
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): { errorOutput: string }[];
  listMemoryEntries(projectId: ProjectId): MemoryEntryView[];
  listProjectRules(projectId: ProjectId): ProjectRuleView[];
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
  "ts tsx js jsx mjs cjs mts cts py go rs java rb c h cpp hpp cs swift kt json yml yaml toml sql sh".split(
    " ",
  ),
);

// Glob patterns (src/**/*.ts) never appear verbatim in tool output, so they
// can never substring-match a later chunk — they only dilute the cap-12
// hint budget. Only literal path tokens qualify as hints.
const GLOB_METACHARS = /[*?[{]/;

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

const MAX_HINT_ITEMS = 12;

export function buildSessionHints(
  registry: HintSource,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionHints {
  // All three sources iterate newest-first: the caps below evict by insertion
  // order, and when the budget overflows the STALE tokens are the ones to lose.
  const signatures = new Set<string>();
  for (const f of [...registry.listSessionFailures(projectId, sessionId)].reverse()) {
    for (const sig of extractFailureSignatures(f.errorOutput)) signatures.add(sig);
  }

  // relatedFiles/relatedSymbols ONLY — keywords, title, and content are prose
  // retrieval surfaces; feeding them into the substring-match boost would fire
  // on generic words instead of concrete code locations. Approval + stale gate
  // mirrors core's recall predicate (the port deliberately does not carry the
  // bi-temporal/tier fields core's fuller isRecallable also checks).
  const memory = new Set<string>();
  for (const entry of [...registry.listMemoryEntries(projectId)].reverse()) {
    if (entry.approval !== "approved" || entry.stale) continue;
    for (const file of entry.relatedFiles ?? []) {
      if (file.length >= MIN_SIGNATURE_LENGTH) memory.add(file);
    }
    for (const symbol of entry.relatedSymbols ?? []) {
      if (symbol.length >= MIN_SIGNATURE_LENGTH) memory.add(symbol);
    }
  }

  const conventions = new Set<string>();
  for (const rule of [...registry.listProjectRules(projectId)].reverse()) {
    for (const pattern of rule.appliesTo) {
      if (GLOB_METACHARS.test(pattern)) continue;
      if (pattern.length >= MIN_SIGNATURE_LENGTH) conventions.add(pattern);
    }
  }

  return {
    recentFailures: [...signatures].slice(0, MAX_SIGNATURES_PER_SESSION),
    recentMemory: [...memory].slice(0, MAX_HINT_ITEMS),
    projectConventions: [...conventions].slice(0, MAX_HINT_ITEMS),
  };
}
