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
