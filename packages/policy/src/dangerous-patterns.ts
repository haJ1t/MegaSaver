// epic §9c — LOCKED. Matched against the full rendered command-line
// string (`[command, ...args].join(" ")`) so `bash -c "rm -rf /"` and
// dangerous pipelines through an allow-listed binary are still caught.
export const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /rm\s+-rf\s+\//,
  /sudo/,
  /mkfs/,
  /shutdown/,
  /curl.+\|\s*sh/,
  /wget.+\|\s*sh/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
];
