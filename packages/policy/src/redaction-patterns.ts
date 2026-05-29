import { z } from "zod";

// epic §9d — LOCKED baseline. Validated at module load (boundary, §8).
// Application order matters: anthropic_key MUST run before openai_key
// because `sk-ant-` is a prefix of the `sk-` shape; db_url before
// generic schemes; private_key_block spans newlines. All compiled with
// the `g` flag so `count` reflects every occurrence.
const redactionPatternSchema = z.object({
  name: z.string(),
  pattern: z.instanceof(RegExp),
  replacement: z.string(),
});

export type RedactionPattern = z.infer<typeof redactionPatternSchema>;

const baseline: RedactionPattern[] = [
  {
    name: "github_token",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,
    replacement: "gh*_[REDACTED]",
  },
  {
    name: "anthropic_key",
    pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    replacement: "sk-ant-[REDACTED]",
  },
  {
    name: "openai_key",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "sk-[REDACTED]",
  },
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "AKIA[REDACTED]",
  },
  {
    name: "aws_secret_key",
    pattern: /(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/g,
    replacement: "[REDACTED]",
  },
  {
    name: "bearer_token",
    pattern: /bearer\s+[A-Za-z0-9\-._~+/=]{20,}/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "eyJ[REDACTED]",
  },
  {
    name: "private_key_block",
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    name: "env_value",
    pattern: /(?<=^[A-Z_]+=)["'].+?["']/gm,
    replacement: '"[REDACTED]"',
  },
  {
    name: "db_url",
    pattern: /(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/]+:[^\s@]+@\S+/g,
    replacement: "[scheme]://[REDACTED]@[host]",
  },
];

export const REDACTION_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(baseline);
