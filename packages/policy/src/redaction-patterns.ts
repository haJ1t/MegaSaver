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
  // --- Contextual secrets (no recognised prefix; identified by surrounding key).
  // Appended AFTER the prefix/structure patterns so those run first; these catch
  // the residue. Each uses a LOOKBEHIND for the indicator (param/flag/header/
  // scheme) so only the secret VALUE is matched and replaced with the marker —
  // the readable structure survives, and a redacted fetch URL still satisfies
  // overlayChunkSetSchema's z.string().url() guard. (Backreferences are not an
  // option: redact() applies replacements via a function, so `$1` is literal.)
  {
    // Credentials in URL userinfo on ANY scheme (db_url covers the db schemes
    // first; this catches http(s)/ftp/etc.). Username may be empty (password-only
    // / token-as-password) and the password may contain '/' — matching db_url's
    // strength. Scheme + host are kept, so the URL stays valid:
    // scheme://user:pass@host -> scheme://[REDACTED]@host. (A literal '@' inside
    // the password — which RFC 3986 requires percent-encoded — leaves a tail; the
    // first-'@' anchor is deliberate to avoid over-matching host/path.)
    name: "url_basic_auth",
    pattern: /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s@]+(?=@)/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret-valued query OR fragment params (#access_token=... is the OAuth
    // implicit-flow callback shape). Param name gated to clearly sensitive keys
    // to avoid redacting benign params (?page=, ?sort=); value stops at
    // &/#/quote/ws.
    name: "url_query_secret",
    pattern:
      /(?<=[?&#](?:access[_-]?token|api[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?(?:id|token)|id[_-]?token|token|secret|password|passwd|pwd|apikey|signature)=)[^&\s#"'<>]+/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret passed via a CLI flag with '=': --token=VALUE. Unambiguous, so the
    // unquoted value is matched directly. Bare --key is excluded (too ambiguous).
    name: "cli_secret_flag_eq",
    pattern:
      /(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)=)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi,
    replacement: "[REDACTED]",
  },
  {
    // Secret passed via a space-separated CLI flag: --token "VALUE". ONLY a
    // QUOTED value is matched — an unquoted next token is indistinguishable from
    // prose / a following flag / a shell operator (&&, |, >), so matching it would
    // over-redact captured help text and error messages.
    name: "cli_secret_flag_spaced",
    pattern:
      /(?<=--(?:password|passwd|pwd|token|api[_-]?key|apikey|secret|access[_-]?token|client[_-]?secret|auth[_-]?token)[ \t])(?:"[^"]*"|'[^']*')/gi,
    replacement: "[REDACTED]",
  },
  {
    // Dedicated api-key / auth-token request headers (Bearer is handled above).
    name: "api_key_header",
    pattern:
      /(?<=(?:x-api-key|x-auth-token|x-access-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s"']{8,})/gi,
    replacement: "[REDACTED]",
  },
  {
    // HTTP Basic credentials in an Authorization header (Bearer covered above).
    name: "basic_auth_header",
    pattern: /(?<=authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]{8,}/gi,
    replacement: "[REDACTED]",
  },
];

export const REDACTION_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(baseline);
