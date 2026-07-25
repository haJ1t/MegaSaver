// packages/policy/src/redact.ts
import { OBSERVED_PATTERNS, REDACTION_PATTERNS } from "./redaction-patterns.js";

export type DetectorCount = { name: string; count: number };

// Unchanged public contract — do NOT add fields here.
export type RedactResult = { redacted: string; count: number };

// Richer variant for the firewall path (filterOutput only).
export type RedactFindings = {
  redacted: string;
  count: number;
  findings: DetectorCount[];
  observed: DetectorCount[];
};

export function redactWithFindings(text: string): RedactFindings {
  let redacted = text;
  let count = 0;
  const findings: DetectorCount[] = [];
  for (const { name, pattern, replacement, validate } of REDACTION_PATTERNS) {
    let patternCount = 0;
    redacted = redacted.replace(pattern, (match) => {
      if (validate !== undefined && !validate(match)) return match;
      patternCount += 1;
      return replacement;
    });
    if (patternCount > 0) {
      count += patternCount;
      findings.push({ name, count: patternCount });
    }
  }
  const observed: DetectorCount[] = [];
  for (const { name, pattern } of OBSERVED_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches !== null && matches.length > 0) {
      observed.push({ name, count: matches.length });
    }
  }
  return { redacted, count, findings, observed };
}

// Existing signature preserved: strip the richer result to {redacted, count}.
export function redact(text: string): RedactResult {
  const { redacted, count } = redactWithFindings(text);
  return { redacted, count };
}

// For the value-free firewall ledger ONLY. Scrubs secrets + PII like redact(),
// AND emails — which the agent-visible output path deliberately only observes
// (redacting them there corrupts git/package metadata), but which must NEVER
// persist into a ledger sourcePath label (F-FW-1). Returns the scrubbed string.
// Ledger-only containment, applied after the agent-path detectors have had
// their turn and BEFORE the email observer. It exists because the ledger must
// not depend on the agent path's bounds: when `url_basic_auth`/`db_url` miss an
// over-long userinfo password, the whole credential used to be caught here by
// `email`'s then-unbounded local part, which swallowed the base64url run plus
// `@host`. Bounding that local part removed the accidental backstop, so this
// makes the containment explicit instead of incidental.
//
// Greedy over non-whitespace, so it reaches the LAST `@` in the token and an
// `@`-bearing password (`user:p@ss@host`) is scrubbed whole. The ledger has no
// evidence-preservation requirement — that is scoped to the agent-visible path
// — so over-scrubbing a label costs nothing. The bound matches the agent-path
// password bound deliberately: the ledger cliff must never sit BELOW the agent
// cliff, or a secret the agent redacts could still be persisted.
const LEDGER_USERINFO = /(?<=:\/\/)[^\s/]{0,8192}@/g;

// Cliff-free floor beneath the scrub above. A bound always leaves a cliff — a
// 9000-character password slips past LEDGER_USERINFO's 8192 and, before this,
// persisted whole. This has no required literal after the run, so it cannot
// backtrack: it matches or fails in one pass, linear, no bound needed. Any
// non-whitespace run this long in a path or command line is a blob or a
// credential, never a label worth keeping, and the ledger is value-free by
// construction (F-FW-1). Ordered AFTER the userinfo scrub so ordinary URLs keep
// their host for report grouping and only the over-long residue is collapsed.
const LEDGER_LONG_TOKEN = /[^\s]{2048,}/g;

export function redactForLedger(text: string): string {
  let out = redactWithFindings(text).redacted;
  out = out.replace(LEDGER_USERINFO, "[REDACTED]@");
  out = out.replace(LEDGER_LONG_TOKEN, "[REDACTED:long-token]");
  for (const { name, pattern } of OBSERVED_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${name}]`);
  }
  return out;
}
