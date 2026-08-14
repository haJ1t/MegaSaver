export type ClaimPattern = { id: string; regex: RegExp };

// LOCKED list (spec Locked Decision 2). Linear-time by construction: fixed-word
// alternations joined by BOUNDED `[ \t]{1,3}` gaps — no unbounded run before a
// required literal (wiki concepts/unbounded-run-redos, the class these must
// never join). Any edit here re-runs apps/cli/test/verify/claim-patterns-redos.
export const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "tests-pass",
    regex:
      /\b(?:all[ \t]{1,3})?tests?[ \t]{1,3}(?:are[ \t]{1,3})?(?:pass(?:es|ed|ing)?|green)\b/gi,
  },
  {
    id: "all-green",
    regex: /\ball[ \t]{1,3}(?:green|checks[ \t]{1,3}pass(?:es|ed|ing)?)\b/gi,
  },
  {
    id: "build-succeeds",
    regex: /\bbuild[ \t]{1,3}(?:succeed(?:s|ed)?|pass(?:es|ed|ing)?|is[ \t]{1,3}green)\b/gi,
  },
  {
    id: "suite-green",
    regex: /\b(?:test[ \t]{1,3})?suite[ \t]{1,3}(?:is[ \t]{1,3})?(?:green|pass(?:es|ed|ing))\b/gi,
  },
  {
    id: "verify-green",
    regex: /\bpnpm[ \t]{1,3}verify[ \t]{1,3}(?:is[ \t]{1,3})?(?:green|pass(?:es|ed|ing))\b/gi,
  },
  {
    id: "lint-clean",
    regex: /\b(?:lint|typecheck)[ \t]{1,3}(?:is[ \t]{1,3})?(?:clean|green|pass(?:es|ed|ing))\b/gi,
  },
];

// Shipped input cap: runVerifyClaims refuses larger input at the boundary, so
// this is the worst case the ReDoS guard must cover (redos-guard-testing rule:
// size the guard at the shipped cap).
export const MAX_CLAIMS_INPUT_BYTES = 8_388_608;

export type DetectedClaim = { patternId: string; excerpt: string; index: number };

const EXCERPT_MAX = 80;
const CONTEXT_CHARS = 20;

function excerptAt(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_CHARS);
  const flat = text
    .slice(start, index + matchLength + CONTEXT_CHARS)
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= EXCERPT_MAX ? flat : `${flat.slice(0, EXCERPT_MAX - 1)}…`;
}

export function scanClaims(text: string): DetectedClaim[] {
  const claims: DetectedClaim[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const matched = match[0] ?? "";
      const index = match.index ?? 0;
      claims.push({ patternId: pattern.id, excerpt: excerptAt(text, index, matched.length), index });
    }
  }
  return claims.sort((a, b) => a.index - b.index || a.patternId.localeCompare(b.patternId));
}
