import { z } from "zod";
import { ibanValid, luhnValid, tcknValid } from "./pii-validators.js";

// epic §9d — LOCKED baseline. Validated at module load (boundary, §8).
// Application order matters: anthropic_key MUST run before openai_key
// because `sk-ant-` is a prefix of the `sk-` shape; db_url before
// generic schemes; private_key_block spans newlines. All compiled with
// the `g` flag so `count` reflects every occurrence.
const redactionPatternSchema = z.object({
  name: z.string(),
  pattern: z.instanceof(RegExp),
  replacement: z.string(),
  validate: z.custom<(match: string) => boolean>((v) => typeof v === "function").optional(),
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
    // Branch 1 is a performance guard that also narrows what matches, so it is
    // not swappable for any equally fast guard. Without it, every `eyJ` inside
    // a dotless base64url run is a start position that greedily scans to
    // end-of-input before failing `\.` — O(n) starts x O(n) length, 8.4 s at
    // 313 KiB. Rejecting glued starts collapses each start to O(1), the whole
    // scan to O(n).
    // Branch 2 costs almost nothing (0.32 ms per 313 KiB) precisely because `%`
    // sits OUTSIDE the run class: it terminates the dotless run, so an admitted
    // start scans only its own token. That is what makes percent-escaped
    // carriers — URL query strings and fragments — cheap to recover while the
    // shapes below are not.
    // Accepted cost (spec 2026-07-20 §5, corrected 20b): a JWT preceded directly
    // by a RAW [A-Za-z0-9_-] no longer redacts, so `session-<jwt>` and
    // `id_token_<jwt>` stay in cleartext. Narrowing the class to [A-Za-z0-9]
    // recovers those two and reintroduces the full quadratic — see
    // test/redact-jwt.test.ts, which pins the percent recoveries too.
    // `Bearer<jwt>`, `ghs_<body>_<jwt>` and raw base64-run glue are lost the
    // same way, and no other detector covers those bytes.
    name: "jwt",
    pattern:
      /(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
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
    // scheme://user:pass@host -> scheme://[REDACTED]@host. The password is LAZY
    // and may contain `@`, `/`, `:` (tools like curl accept unencoded ones); it
    // stops at the FIRST `@` that is followed by a real host (host chars, then a
    // `/?#:` delimiter or end-of-string) OR by end-of-string/whitespace (a
    // host-less userinfo, e.g. `redis://:pw@` at a truncated line boundary — no
    // host to connect to, but the credential is still a secret to scrub). That
    // anchor scrubs a whole `@`-bearing password (`user:p@ss@host` ->
    // `[REDACTED]@host`) without over-matching a later `@` in the path
    // (`.../@2x.png`). User stops at the first `:` (the user:password split).
    name: "url_basic_auth",
    pattern:
      /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/?#:]*:[^\s?#]+?(?=@(?:[^\s/?#@:]+(?:[/?#:]|$)|\s|$))/gi,
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
  {
    // 13–19 digits with optional single space/dash separators. The regex is
    // deliberately broad; the Luhn validate gate is what makes it precise.
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replacement: "[REDACTED:credit_card]",
    validate: (match: string) => luhnValid(match.replace(/[ -]/g, "")),
  },
  {
    // `i` flag: IBANs appear lower/mixed-case in prose, and ibanValid upcases
    // before checking — without it a valid lowercase IBAN never reaches the
    // validator and leaks unredacted.
    name: "iban",
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/gi,
    replacement: "[REDACTED:iban]",
    validate: (match: string) => ibanValid(match),
  },
  {
    name: "tr_national_id",
    pattern: /\b[1-9][0-9]{10}\b/g,
    replacement: "[REDACTED:tr_national_id]",
    validate: (match: string) => tcknValid(match),
  },
];

export const REDACTION_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(baseline);

// Count-only observers: matches are COUNTED into RedactResult.observed but the
// text is never modified (spec: email redaction corrupts git/package metadata
// the agent legitimately needs).
const observedBaseline: RedactionPattern[] = [
  {
    name: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "",
  },
];
export const OBSERVED_PATTERNS: readonly RedactionPattern[] = z
  .array(redactionPatternSchema)
  .parse(observedBaseline);
