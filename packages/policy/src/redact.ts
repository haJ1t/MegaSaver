import { REDACTION_PATTERNS } from "./redaction-patterns.js";

export type RedactResult = { redacted: string; count: number };

export function redact(text: string): RedactResult {
  let redacted = text;
  let count = 0;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      count += 1;
      return replacement;
    });
  }
  return { redacted, count };
}
