import { describe, expect, it } from "vitest";
import { redactForLedger, redactWithFindings } from "../src/redact.js";
import { OBSERVED_PATTERNS, REDACTION_PATTERNS } from "../src/redaction-patterns.js";

// Spec: docs/superpowers/specs/2026-07-25-redaction-superlinear-patterns-design.md
// Seven patterns were super-linear on long runs. Three carry a first-character
// lookahead guard (§3a); four carry a bound (§3b).

const entry = (name: string) => {
  const found = [...REDACTION_PATTERNS, ...OBSERVED_PATTERNS].find((p) => p.name === name);
  if (found === undefined) throw new Error(`${name} missing from the pattern tables`);
  return found;
};

// ─── §6.1 structural gates ───────────────────────────────────────────────────
//
// For the three guarded patterns the assertion is startsWith, not includes:
// moving the guard to AFTER the lookbehind is semantically identical — same
// matches, byte-identical output, full quadratic restored. No output assertion
// can see that edit; only position can. Verified by mutation.

describe("structural gates (spec §6.1)", () => {
  it.each([
    ["aws_secret_key", "(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\\s*=\\s*)[A-Za-z0-9/+]{40}"],
    [
      "api_key_header",
      "(?=\\S)(?<=(?:x-api-key|x-auth-token|x-access-token)\\s*[:=]\\s*)(?:\"[^\"]*\"|'[^']*'|[^\\s\"']{8,})",
    ],
    [
      "basic_auth_header",
      "(?=[A-Za-z0-9+/=])(?<=authorization\\s*[:=]\\s*basic\\s+)[A-Za-z0-9+/=]{8,}",
    ],
  ])("%s is start-position guarded before its lookbehind", (name, guard) => {
    expect(entry(name).pattern.source.startsWith(guard)).toBe(true);
  });

  // db_url and private_key_block are covered by the byte-exact §5a pins below,
  // which strictly subsume a substring check. Only the two non-lock-table
  // bounded patterns need their own gate.
  it.each([
    [
      "url_basic_auth",
      "(?<=[a-z][a-z0-9+.-]*:\\/\\/)[^\\s/?#:]*:[^\\s?#]{1,8192}?(?=@(?:[^\\s/?#@:]+(?:[/?#:]|$)|\\s|$))",
    ],
    ["email", "[A-Za-z0-9._%+-]{1,64}"],
  ])("%s bounds the run that drives its quadratic", (name, bound) => {
    expect(entry(name).pattern.source).toContain(bound);
  });

  // Nothing else in the repo pins .flags, and count derives from a global
  // replace: dropping /g silently under-reports every finding.
  it.each([
    ["aws_secret_key", "gi"],
    ["aws_access_key", "g"],
    ["github_token", "g"],
    ["api_key_header", "gi"],
    ["basic_auth_header", "gi"],
    ["db_url", "g"],
    ["url_basic_auth", "gi"],
    ["private_key_block", "g"],
    ["ssh2_private_key_block", "g"],
    ["putty_private_key", "g"],
    ["age_secret_key", "g"],
    ["jwk_private_key", "g"],
    ["aws_session_token", "gi"],
    ["json_secret_field", "gi"],
    ["netrc_password", "g"],
    ["npm_token", "g"],
    ["pypi_token", "g"],
    ["vault_token", "g"],
    ["ansible_vault", "g"],
    ["bip32_xprv", "g"],
    ["base64_pem_block", "g"],
    ["stripe_key", "g"],
    ["slack_token", "g"],
    ["gitlab_token", "g"],
    ["sendgrid_key", "g"],
    ["digitalocean_token", "g"],
    ["twilio_api_key_sid", "g"],
    ["connection_string_secret", "gi"],
    ["slack_webhook_url", "g"],
  ])("%s keeps flags %s", (name, flags) => {
    expect(entry(name).pattern.flags).toBe(flags);
  });
});

// The three §5a lock-table rows this change amends, pinned byte-for-byte.
// docs/superpowers/specs/2026-05-10-bb3-policy-design.md §5a records these
// verbatim; if you edit one here, amend that row in the same commit.
describe("§5a lock-table rows", () => {
  it.each([
    ["aws_secret_key", "(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\\s*=\\s*)[A-Za-z0-9/+]{40}"],
    ["aws_access_key", "A(?:KIA|SIA)[0-9A-Z]{16}"],
    ["github_token", "(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})"],
    ["db_url", "(?:postgres|postgresql|mysql|mongodb):\\/\\/[^\\s/]{1,256}:[^\\s@]{1,8192}@\\S+"],
    [
      "private_key_block",
      "-----BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\\s\\S]{1,32768}?-----END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----",
    ],
  ])("%s matches the amended §5a bytes", (name, source) => {
    expect(entry(name).pattern.source).toBe(source);
  });
});

// The four detectors added 2026-07-25 are NOT §5a lock-table rows, but they need
// the same byte-exactness for the same reason: without it, every bound-edge and
// character-class mutation survives the whole suite. Eleven did.
describe("post-lock detector bytes", () => {
  it.each([
    [
      "ssh2_private_key_block",
      "---- BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----[\\s\\S]{1,32768}?---- END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----",
    ],
    [
      "putty_private_key",
      "PuTTY-User-Key-File-\\d{1,2}:[\\s\\S]{1,8192}?Private-MAC:[ \\t]*[0-9a-fA-F]{16,128}",
    ],
    ["age_secret_key", "AGE-SECRET-KEY-1[0-9A-Z]{50,120}"],
    [
      "jwk_private_key",
      '\\{(?=[^{}]{0,4096}"kty"\\s*:\\s*"(?:RSA|EC|OKP|oct)")(?=[^{}]{0,4096}"(?:d|k)"\\s*:\\s*"[A-Za-z0-9_-]{20,}")[^{}]{1,4096}\\}',
    ],
    ["stripe_key", "(?:(?:sk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{16,}"],
    ["slack_token", "(?:xox[baprse]|xapp)-[A-Za-z0-9-]{10,}"],
    [
      "gitlab_token",
      "gl(?:pat|oas|rtr|rt|dt|cbt|ptt|ft|ffct|imt|soat|agent|wt)-[A-Za-z0-9_-]{20,}",
    ],
    ["sendgrid_key", "SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}"],
    ["digitalocean_token", "do[opr]_v1_[a-f0-9]{64}"],
    ["twilio_api_key_sid", "\\bSK[0-9a-f]{32}\\b"],
    [
      "slack_webhook_url",
      "(?=[A-Za-z0-9/_-])(?<=https?:\\/\\/hooks\\.slack\\.com\\/(?:services|workflows|triggers)\\/)[A-Za-z0-9/_-]{16,}",
    ],
    [
      "connection_string_secret",
      "(?=[^;\\s])(?<=(?:^|;)\\s{0,8}(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)\\s{0,8}=\\s{0,8})(?:\"[^\"]{8,8192}\"|'[^']{8,8192}'|[^;\\s]{8,})",
      // 2026-07-26: bounded `\s{0,8}` gaps and quoted alternatives. The gaps
      // are BOUNDED on purpose — `\s*` would make this an unbounded-variable-
      // length lookbehind, the shape the superlinear change removed. The quoted
      // runs are bounded for OVER-redaction, not time: on a value whose closing
      // quote is missing, an unbounded run reaches the next quote in the file.
    ],
  ])("%s matches its pinned bytes", (name, source) => {
    expect(entry(name).pattern.source).toBe(source);
  });

  it.each([
    [
      "aws_session_token",
      "(?=[A-Za-z0-9/+=])(?<=aws_session_token\\s*[:=]\\s*)[A-Za-z0-9/+=]{40,}",
    ],
    [
      "json_secret_field",
      '(?=[^"\\\\\\s])(?<="(?:refresh_?token|client_?secret|identity_?token|private_key_?id|secret_?access_?key|session_?token|auth)"\\s*:\\s*")(?:(?:Basic|Bearer|Digest|Token) )?[^"\\\\\\s]{16,}',
    ],
    [
      "netrc_password",
      "(?=\\S)(?<=(?:\\bmachine\\s{1,8}\\S{1,253}|[\\r\\n][ \\t]{0,8}default)\\s{1,8}(?:(?:login|account)\\s{1,8}\\S{1,64}\\s{1,8}){0,2}password\\s{1,8})\\S{6,}",
    ],
    ["npm_token", "npm_[A-Za-z0-9]{30,}"],
    ["pypi_token", "pypi-[A-Za-z0-9_-]{16,}"],
    ["vault_token", "hv[sb]\\.[A-Za-z0-9_-]{20,}"],
    [
      "ansible_vault",
      "\\$ANSIBLE_VAULT;[\\d.]{1,8};[A-Z0-9]{3,32}(?:;[\\w.-]{1,64})?[\\s0-9a-f]{32,65536}",
    ],
    ["bip32_xprv", "[xyz]prv[A-HJ-NP-Za-km-z1-9]{95,120}"],
    [
      "base64_pem_block",
      "LS0tLS1CRUdJTiB[A-Za-z0-9+/=]{0,64}(?:UklWQVRFIEtF|VkFURSBL|SVZBVEUgS0VZ|RUNSRVQgS0VZ|UkVUIEtF|Q1JFVCBL)[A-Za-z0-9+/=]{16,65536}(?:[\\r\\n]{1,2}[ \\t]{0,8}[A-Za-z0-9+/=]{16,65536}){0,4096}",
    ],
  ])("%s matches its pinned bytes", (name, source) => {
    expect(entry(name).pattern.source).toBe(source);
  });

  // Ordering is load-bearing for jwk_private_key and for jwt, and for the same
  // reason: both carry base64url bodies, which contain `-` and `_` as well as
  // every alphanumeric, so a prefix detector can fire INSIDE one. Its
  // replacement inserts `[`, the enclosing detector's required span (jwk's
  // closing quote, jwt's segment-terminating `.`) can no longer complete, and
  // the whole secret survives with only the prefix span redacted. Measured 63
  // per 100,000 RSA JWKs and 120 per 100,000 JWTs before the two reorders.
  // The list is every prefix detector in the table, not the three that existed
  // when this test was written — a new one appended below either of these two
  // reopens the leak, and it must fail here rather than in a Monte Carlo.
  const PREFIX_DETECTORS = [
    "github_token",
    "anthropic_key",
    "openai_key",
    "npm_token",
    "pypi_token",
    "vault_token",
    "bip32_xprv",
    // The 2026-07-26 vendor rows are prefix detectors too. They were missing
    // here while the comment above claimed the list was complete.
    "stripe_key",
    "slack_token",
    "gitlab_token",
    "sendgrid_key",
    "digitalocean_token",
    "twilio_api_key_sid",
  ] as const;

  it.each(["jwk_private_key", "jwt", "slack_webhook_url"] as const)(
    "%s runs before every prefix detector",
    (early) => {
      const names = REDACTION_PATTERNS.map((x) => x.name);
      expect(names).toContain(early);
      for (const later of PREFIX_DETECTORS) {
        // Without this, a renamed detector makes indexOf return -1 and the
        // comparison below passes vacuously.
        expect(names).toContain(later);
        expect(names.indexOf(early)).toBeLessThan(names.indexOf(later));
      }
    },
  );
});

// ─── §6.2 equivalence corpus ─────────────────────────────────────────────────
//
// Pattern-level, one detector in isolation. That isolation is deliberate and
// follows the jwt spec §6 precedent: through the real pipeline an earlier
// detector often consumes the bytes first (jwt now claims `Bearer <jwt>` ahead
// of bearer_token, and anthropic_key claims `sk-ant-` ahead of openai_key),
// which would make these assertions test ordering rather than the pattern. The public surface is exercised separately below — both are needed.
const apply = (name: string, input: string): string => {
  const { pattern, replacement, validate } = entry(name);
  return input.replace(pattern, (match) =>
    validate !== undefined && !validate(match) ? match : replacement,
  );
};

// OPAQUE, not a JWS. A fixture starting `eyJ…` is redacted by the `jwt`
// detector regardless of this bound, so a JWS payload silently proves nothing
// about db_url/url_basic_auth coverage. This is a JWE shape: five segments
// whose second is a wrapped CEK, so `jwt` cannot match it — which is exactly
// why the 2048 bound this replaces was a live cleartext hole.
const OPAQUE_2_5K = `${"A".repeat(342)}.${"B".repeat(16)}.${"C".repeat(2100)}.${"D".repeat(22)}`;
const wrap64 = (s: string) => (s.match(/.{1,64}/g) ?? []).join("\n");
// The empty label is PKCS#8 (`openssl genpkey`, GCP service-account keys,
// Kubernetes TLS secrets) and PGP carries a ` BLOCK` suffix. Defaulting every
// fixture to "RSA " is what concealed both for so long — keep the label
// parameterised.
const pem = (base64Chars: number, label = "RSA ") => {
  const suffix = label === "PGP " ? " BLOCK" : "";
  return `-----BEGIN ${label}PRIVATE KEY${suffix}-----\n${wrap64("A".repeat(base64Chars))}\n-----END ${label}PRIVATE KEY${suffix}-----`;
};

describe("still redacts the long-secret shapes a bound could plausibly break (spec §6.2)", () => {
  it.each([
    ["a 2.5 KB opaque token (JWE shape)", OPAQUE_2_5K],
    ["an 8192-char password, exactly at the bound", "p".repeat(8192)],
  ])("db_url redacts %s as the password", (_label, password) => {
    expect(apply("db_url", `postgres://user:${password}@db.example.com:5432/app`)).toBe(
      "[scheme]://[REDACTED]@[host]",
    );
  });

  it.each([
    ["a 2.5 KB opaque token (JWE shape)", OPAQUE_2_5K],
    ["an 8192-char password, exactly at the bound", "p".repeat(8192)],
  ])("url_basic_auth redacts %s as the password", (_label, password) => {
    expect(apply("url_basic_auth", `https://user:${password}@api.example.com/v1`)).toBe(
      "https://[REDACTED]@api.example.com/v1",
    );
  });

  // Bodies are 64-column wrapped, as real PEM is. That matters: the bound counts
  // every character between the markers, newlines included, so a single-line
  // fixture overstates capacity by ~1 char in 65 and hides the true ceiling.
  it.each([
    ["RSA-4096", 3200],
    ["RSA-16384", 12500],
    ["Classic McEliece, the largest practical key", 18828],
    ["the last base64 length that fits", 32262],
  ])("private_key_block redacts a %s key", (_label, base64Chars) => {
    expect(apply("private_key_block", pem(base64Chars))).toBe("[REDACTED PRIVATE KEY]");
  });

  // Every header form OpenSSL, OpenSSH and GnuPG actually emit. The first two
  // rows were a live cleartext leak until 2026-07-25: `[A-Z ]+` required at
  // least one character between `BEGIN ` and `PRIVATE KEY`, so unlabelled
  // PKCS#8 could not match, and PGP's trailing ` BLOCK` broke the `-----`
  // anchor. PKCS#8 is the most common modern form.
  it.each([
    ["", "PKCS#8"],
    ["PGP ", "PGP"],
    ["RSA ", "PKCS#1"],
    ["EC ", "SEC1"],
    ["DSA ", "DSA"],
    ["OPENSSH ", "OpenSSH"],
    ["ENCRYPTED ", "encrypted PKCS#8"],
  ])("private_key_block redacts a '%s' labelled key (%s)", (label) => {
    expect(apply("private_key_block", pem(512, label))).toBe("[REDACTED PRIVATE KEY]");
  });

  // Every label ending in `PRIVATE KEY` in OpenSSL 3.6.2's own PEM table
  // (`strings libcrypto | grep 'PRIVATE KEY$'`), which is the authoritative list
  // of what OpenSSL will decode as a private key. The uppercase-and-space class
  // this replaces covered 10 of 29 — it missed the entire NIST post-quantum set,
  // every modern curve, and `X9.42 DH` (a dot).
  //
  // Note the lowercase `f`/`s` suffixes on SLH-DSA: those are why the group class
  // is `[A-Za-z0-9]` and not `[A-Z0-9]`, and why an all-uppercase label
  // assumption is wrong. `-----begin private key-----` still does not match, and
  // is pinned above — the literal `BEGIN`/`END` carry that, not the label class.
  it.each([
    "ANY PRIVATE KEY",
    "DH PRIVATE KEY",
    "ED25519 PRIVATE KEY",
    "ED448 PRIVATE KEY",
    "X25519 PRIVATE KEY",
    "X448 PRIVATE KEY",
    "SM2 PRIVATE KEY",
    "RSA-PSS PRIVATE KEY",
    "X9.42 DH PRIVATE KEY",
    "ML-DSA-44 PRIVATE KEY",
    "ML-DSA-65 PRIVATE KEY",
    "ML-DSA-87 PRIVATE KEY",
    "ML-KEM-512 PRIVATE KEY",
    "ML-KEM-768 PRIVATE KEY",
    "ML-KEM-1024 PRIVATE KEY",
    "SLH-DSA-SHA2-128f PRIVATE KEY",
    "SLH-DSA-SHA2-128s PRIVATE KEY",
    "SLH-DSA-SHA2-192f PRIVATE KEY",
    "SLH-DSA-SHA2-192s PRIVATE KEY",
    "SLH-DSA-SHA2-256f PRIVATE KEY",
    "SLH-DSA-SHA2-256s PRIVATE KEY",
    "SLH-DSA-SHAKE-128f PRIVATE KEY",
    "SLH-DSA-SHAKE-128s PRIVATE KEY",
    "SLH-DSA-SHAKE-192f PRIVATE KEY",
    "SLH-DSA-SHAKE-192s PRIVATE KEY",
    "SLH-DSA-SHAKE-256f PRIVATE KEY",
    "SLH-DSA-SHAKE-256s PRIVATE KEY",
  ])("private_key_block redacts OpenSSL's '%s' armour", (header) => {
    const input = `-----BEGIN ${header}-----\n${wrap64("A".repeat(512))}\n-----END ${header}-----`;
    expect(apply("private_key_block", input)).toBe("[REDACTED PRIVATE KEY]");
  });

  // The matching PUBLIC forms must stay untouched — the label widening is the
  // shape most likely to catch them by accident.
  it.each([
    "ED25519 PUBLIC KEY",
    "X9.42 DH PUBLIC KEY",
    "ML-KEM-512 PUBLIC KEY",
    "SLH-DSA-SHAKE-256s PUBLIC KEY",
    "SSH2 PUBLIC KEY",
  ])("private_key_block does not match OpenSSL's '%s' armour", (header) => {
    const input = `-----BEGIN ${header}-----\nAAAA\n-----END ${header}-----`;
    expect(apply("private_key_block", input)).toBe(input);
  });

  // Widening the label to `[A-Z ]*` and allowing ` BLOCK` must not start
  // matching non-private-key armour.
  //
  // Which of these are load-bearing, measured against the mutant family rather
  // than assumed: PUBLIC KEY and PGP PUBLIC KEY BLOCK do the work, and the
  // latter uniquely catches a mutant that floats ` BLOCK` off `PRIVATE KEY`.
  // CERTIFICATE and PGP MESSAGE kill nothing in this family and are kept only
  // as documentation of intent. The lowercase row does NOT constrain the label
  // class at all — the literal `BEGIN`/`END` are uppercase, so even widening
  // the label to `[\s\S]*?` leaves it unmatched; it pins the absence of the `i`
  // flag, which the flags test already covers.
  it.each([
    ["-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"],
    ["-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"],
    ["-----BEGIN PGP MESSAGE-----\nAAAA\n-----END PGP MESSAGE-----"],
    ["-----BEGIN PGP PUBLIC KEY BLOCK-----\nAAAA\n-----END PGP PUBLIC KEY BLOCK-----"],
    ["the -----BEGIN PRIVATE KEY----- marker in prose, with no END"],
    ["-----begin private key-----\nAAAA\n-----end private key-----"],
    // The END marker's label was entirely unfenced: every fixture above pairs
    // matching BEGIN/END labels, so all of them are rejected at the BEGIN
    // marker and the END marker is never consulted. A mutant loosening only the
    // END side to `[A-Z ]*KEY` survived the whole suite.
    ["-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PUBLIC KEY-----"],
    // The label is a sequence of alphanumeric groups; every `.`/`-` inside one
    // must sit BETWEEN alphanumerics. These four all match a permissive
    // `[A-Za-z0-9. -]*` class and must not match here — they are what stops a
    // future edit swapping the structure for a class, which measured 4x slower
    // bounded and fully quadratic unbounded (the class covers every character
    // of `-----BEGIN A PRIVATE KEY-----`, so the label eats the whole input).
    ["-----BEGIN A- PRIVATE KEY-----\nAAAA\n-----END A- PRIVATE KEY-----"],
    ["-----BEGIN -A PRIVATE KEY-----\nAAAA\n-----END -A PRIVATE KEY-----"],
    ["-----BEGIN A. PRIVATE KEY-----\nAAAA\n-----END A. PRIVATE KEY-----"],
    ["-----BEGIN A--B PRIVATE KEY-----\nAAAA\n-----END A--B PRIVATE KEY-----"],
    // ` BLOCK` is a literal word, not "any trailing word" and not "any
    // whitespace + BLOCK".
    ["-----BEGIN PGP PRIVATE KEY ARMOR-----\nAAAA\n-----END PGP PRIVATE KEY ARMOR-----"],
    ["-----BEGIN PGP PRIVATE KEY\nBLOCK-----\nAAAA\n-----END PGP PRIVATE KEY\nBLOCK-----"],
    // The space after BEGIN/END is a literal, not part of the label class.
    ["-----BEGINPRIVATE KEY-----\nAAAA\n-----ENDPRIVATE KEY-----"],
  ])("private_key_block does not match %s", (input) => {
    expect(apply("private_key_block", input)).toBe(input);
  });

  // GnuPG's own armour table carries THREE key-block headers, not two:
  // PRIVATE, PUBLIC and SECRET (`strings $(which gpg) | grep 'KEY BLOCK'`).
  // SECRET is a real exported private key and leaked until 2026-07-25.
  it("private_key_block redacts a PGP SECRET KEY BLOCK", () => {
    const input =
      "-----BEGIN PGP SECRET KEY BLOCK-----\nAAAABBBBCCCC\n-----END PGP SECRET KEY BLOCK-----";
    expect(apply("private_key_block", input)).toBe("[REDACTED PRIVATE KEY]");
  });

  // Mismatched BEGIN/END labels redact ON PURPOSE. Concatenated, hand-edited or
  // mislabelled exports are real, and tying the two markers with a backreference
  // would turn this robustness case into precisely the leak class this pattern
  // exists to close. Every other PEM fixture here is symmetric by construction,
  // so without this row a backreference edit passes the entire behavioural
  // suite. The cost is bounded: both markers must still say PRIVATE/SECRET KEY,
  // which the must-not-match rows above pin.
  it.each([
    ["-----BEGIN PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"],
    ["-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"],
  ])("private_key_block redacts mismatched-but-private armour %s", (input) => {
    expect(apply("private_key_block", input)).toBe("[REDACTED PRIVATE KEY]");
  });

  // ACCEPTED over-redaction, pinned so it stays a decision rather than a
  // surprise. Any text quoting BOTH markers is now consumed — a PEM parse error
  // naming them, or prose describing the format. Neither matched before, since
  // `[A-Z ]+` demanded a label.
  //
  // The obvious mitigation, requiring a newline after the BEGIN marker, was
  // rejected: GCP service-account JSON carries the key with literal `\n`
  // ESCAPES rather than real newlines, so it would stop redacting those. Losing
  // a diagnostic line is the cheaper error.
  it.each([
    [`error: expected "-----BEGIN PRIVATE KEY-----" but found "-----END PRIVATE KEY-----"`],
    [
      "A PKCS#8 file starts with -----BEGIN PRIVATE KEY----- and ends with -----END PRIVATE KEY-----.",
    ],
  ])("private_key_block over-redacts prose quoting both markers (accepted) %s", (input) => {
    expect(apply("private_key_block", input)).toContain("[REDACTED PRIVATE KEY]");
  });

  // GCP service-account JSON: the key is one JSON string with literal backslash-n
  // escapes, not real newlines. `[\s\S]` covers the two-character escape.
  it("private_key_block redacts a GCP service-account key with literal \\n escapes", () => {
    const input = `{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\n${"MIIEvQ".repeat(40)}\\n-----END PRIVATE KEY-----\\n"}`;
    expect(apply("private_key_block", input)).not.toContain("MIIEvQ");
  });

  it("aws_secret_key still spans a newline-and-indent gap after the guard", () => {
    expect(apply("aws_secret_key", `aws_secret_access_key =\n  ${"A".repeat(40)}`)).toBe(
      "aws_secret_access_key =\n  [REDACTED]",
    );
  });

  // Whitespace BEFORE the separator. Without this fixture, deleting the `\s*`
  // ahead of `[:=]` in api_key_header — or ahead of `basic` in
  // basic_auth_header — passes the whole suite while `x-api-key : v` leaks.
  // This change edited those two patterns specifically for lookbehind
  // whitespace, so the corpus has to contain some.
  it.each([
    ["x-api-key : abcdef123456", "x-api-key : [REDACTED]"],
    ['x-api-key: "abcdef123456"', "x-api-key: [REDACTED]"],
    ["x-auth-token=abcdef123456", "x-auth-token=[REDACTED]"],
  ])("api_key_header redacts %s", (input, expected) => {
    expect(apply("api_key_header", input)).toBe(expected);
  });

  it.each([
    ["Authorization : Basic dXNlcjpw", "Authorization : Basic [REDACTED]"],
    ["Authorization:  Basic   QWxhZGRpbjpvcGVuc2VzYW1l", "Authorization:  Basic   [REDACTED]"],
  ])("basic_auth_header redacts %s", (input, expected) => {
    // The 8-char credential also pins {8,}: widening it to {16,} leaks
    // `Basic dXNlcjpw` and is otherwise invisible.
    expect(apply("basic_auth_header", input)).toBe(expected);
  });

  // A scheme with `+`, `.` or a digit. Narrowing the lookbehind to `[a-z]+`
  // is invisible without one of these and loses every such URL.
  it.each([
    ["svn+ssh://u:pw@host.example.com/repo", "svn+ssh://[REDACTED]@host.example.com/repo"],
    ["s3://key:secret@bucket.example.com/x", "s3://[REDACTED]@bucket.example.com/x"],
  ])("url_basic_auth redacts %s", (input, expected) => {
    expect(apply("url_basic_auth", input)).toBe(expected);
  });

  // The local-part bound has no total-loss shape: an over-long local part makes
  // the match START LATER, so the @domain is always still consumed. That is the
  // whole reason the domain is NOT bounded (spec §3c).
  it("email over-long local part still redacts the address, keeping only a prefix", () => {
    expect(apply("email", `${"a".repeat(100)}@example.com`)).toBe("a".repeat(36));
  });

  it("email at exactly the 64-char RFC 5321 local-part limit consumes the whole address", () => {
    expect(apply("email", `${"a".repeat(64)}@example.com`)).toBe("");
  });
});

describe("disclosed losses — deliberate, see spec §3b before 'fixing' them", () => {
  it.each([
    ["db_url", `postgres://user:${"p".repeat(8193)}@db.example.com/app`],
    ["url_basic_auth", `https://user:${"p".repeat(8193)}@api.example.com/v1`],
  ])("%s password over 8192 chars is not redacted", (name, input) => {
    expect(apply(name, input)).toBe(input);
  });

  it("private_key_block body over 32768 chars between the markers is not redacted", () => {
    const input = pem(32263);
    expect(apply("private_key_block", input)).toBe(input);
  });
});

// ─── non-PEM private-key carriers ────────────────────────────────────────────
//
// Four formats that carry private keys without `-----`-style PEM armour, so
// private_key_block cannot reach them however its label is widened. Each is its
// own detector with its own anchor; none overlaps private_key_block (verified).

describe("non-PEM private-key carriers", () => {
  const SSH2 = `---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nComment: "key"\n${"AAAA\n".repeat(10)}---- END SSH2 ENCRYPTED PRIVATE KEY ----`;
  const PPK = [
    "PuTTY-User-Key-File-3: ssh-ed25519",
    "Encryption: none",
    "Comment: k",
    "Public-Lines: 2",
    "AAAA",
    "BBBB",
    "Private-Lines: 1",
    "SECRETPRIVATELINE",
    "Private-MAC: 0123456789abcdef0123456789abcdef",
  ].join("\n");
  const AGE = `AGE-SECRET-KEY-1${"QZ".repeat(29)}`;

  it("ssh2_private_key_block redacts RFC 4716 four-dash armour", () => {
    const out = redactWithFindings(SSH2);
    expect(out.findings).toEqual([{ name: "ssh2_private_key_block", count: 1 }]);
    expect(out.redacted).toBe("[REDACTED PRIVATE KEY]");
  });

  // RFC 4716 armour is used for PUBLIC keys too — `ssh-keygen -e -m RFC4716`
  // emits exactly this shape. The `PRIVATE KEY` literal is what separates them.
  it("ssh2_private_key_block does not match an RFC 4716 public key", () => {
    const pub = "---- BEGIN SSH2 PUBLIC KEY ----\nAAAA\n---- END SSH2 PUBLIC KEY ----";
    expect(redactWithFindings(pub).redacted).toBe(pub);
  });

  // ssh2 reuses private_key_block's grouped label and must inherit the same four
  // structural fixtures. Without them a mutant flattening it to a character
  // class is caught only by hanging the timing test for eight minutes.
  it.each([["A- "], ["-A "], ["A. "], ["A--B "]])(
    "ssh2_private_key_block rejects the malformed label '%s'",
    (label) => {
      const input = `---- BEGIN ${label}PRIVATE KEY ----\nAAAA\n---- END ${label}PRIVATE KEY ----`;
      expect(redactWithFindings(input).redacted).toBe(input);
    },
  );

  it("putty_private_key redacts a .ppk and leaves no private line behind", () => {
    const out = redactWithFindings(PPK);
    expect(out.findings).toEqual([{ name: "putty_private_key", count: 1 }]);
    expect(out.redacted).not.toContain("SECRETPRIVATELINE");
  });

  it("age_secret_key redacts an age identity but keeps the prefix", () => {
    const out = redactWithFindings(`# created: 2026-07-25\n${AGE}\n`);
    expect(out.findings).toEqual([{ name: "age_secret_key", count: 1 }]);
    expect(out.redacted).toBe("# created: 2026-07-25\nAGE-SECRET-KEY-[REDACTED]\n");
  });

  // The public half of an age identity must survive — it is not a secret and is
  // exactly the sort of evidence the agent may need.
  it("age_secret_key leaves an age public recipient alone", () => {
    const pub = `age1${"qz".repeat(29)}`;
    expect(redactWithFindings(pub).redacted).toBe(pub);
  });

  // JWK: gated on `kty`, because an ungated `"d":"…"` matched 2 of 3 benign JSON
  // objects in measurement. Both key orders, since JSON order is not guaranteed.
  it.each([
    ["RSA, kty first", `{"kty":"RSA","n":"${"A".repeat(60)}","e":"AQAB","d":"${"B".repeat(60)}"}`],
    ["RSA, d first", `{"d":"${"B".repeat(60)}","kty":"RSA","n":"${"A".repeat(60)}"}`],
    ["EC", `{"kty":"EC","crv":"P-256","x":"${"A".repeat(43)}","d":"${"B".repeat(43)}"}`],
    [
      "OKP ed25519",
      `{"kty":"OKP","crv":"Ed25519","x":"${"A".repeat(43)}","d":"${"B".repeat(43)}"}`,
    ],
    ["oct symmetric", `{"kty":"oct","k":"${"K".repeat(43)}"}`],
  ])("jwk_private_key redacts a %s JWK", (_label, input) => {
    const out = redactWithFindings(input);
    expect(out.findings).toEqual([{ name: "jwk_private_key", count: 1 }]);
    expect(out.redacted).toBe("[REDACTED JWK PRIVATE KEY]");
  });

  it.each([
    ["a public JWK with no private field", `{"kty":"RSA","n":"${"A".repeat(60)}","e":"AQAB"}`],
    ["benign JSON with a short d", `{"id":1,"d":"${"a".repeat(40)}"}`],
    ["benign JSON with a date and d", `{"date":"2026-07-25","d":"${"z".repeat(30)}"}`],
    ["a JWK whose d is too short to be key material", `{"kty":"RSA","d":"abc"}`],
  ])("jwk_private_key does not match %s", (_label, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });
});

describe("new detectors — bound edges and disclosed losses", () => {
  const ageBody = (n: number) => `AGE-SECRET-KEY-1${"Q".repeat(n)}`;

  it.each([
    ["49 chars — below the floor", 49, false],
    ["50 chars — the floor", 50, true],
    ["120 chars — the ceiling", 120, true],
  ])("age_secret_key: %s", (_l, n, shouldMatch) => {
    const out = redactWithFindings(ageBody(n)).redacted;
    expect(out === ageBody(n)).toBe(!shouldMatch);
  });

  // The comment used to credit the uppercase class for excluding the public
  // half. It is the PREFIX that does that — pinned both ways so neither claim
  // can rot: a lowercase body must not match, and the public `age1…` must not.
  it.each([`AGE-SECRET-KEY-1${"q".repeat(60)}`, `age1${"qz".repeat(29)}`])(
    "age_secret_key leaves %s alone",
    (input) => {
      expect(redactWithFindings(input).redacted).toBe(input);
    },
  );

  it("age_secret_key redacts every key, not just the first (pins /g)", () => {
    const two = `${ageBody(60)}\n${ageBody(60)}`;
    const out = redactWithFindings(two);
    expect(out.count).toBe(2);
    expect(out.redacted).toBe("AGE-SECRET-KEY-[REDACTED]\nAGE-SECRET-KEY-[REDACTED]");
  });

  it.each([
    ["19 chars — below the floor", 19, false],
    ["20 chars — the floor", 20, true],
  ])("jwk_private_key d of %s", (_l, n, shouldMatch) => {
    const input = `{"kty":"EC","d":"${"B".repeat(n)}"}`;
    expect(redactWithFindings(input).redacted === input).toBe(!shouldMatch);
  });

  // `[^{}]` containment: a benign neighbouring object must survive. A mutant
  // swapping it for `[\s\S]` eats the neighbour, and nothing else catches that.
  it("jwk_private_key does not consume a neighbouring object", () => {
    const input = `{"note":"benign object with no secrets at all"}\n{"kty":"EC","d":"${"B".repeat(43)}"}`;
    expect(redactWithFindings(input).redacted).toBe(
      '{"note":"benign object with no secrets at all"}\n[REDACTED JWK PRIVATE KEY]',
    );
  });

  // DISCLOSED LOSSES — deliberate, see spec §3e before "fixing" them.
  it.each([
    [
      "a nested object sibling (multi-prime RSA oth[])",
      `{"kty":"RSA","d":"${"B".repeat(43)}","oth":[{"r":"x"}]}`,
    ],
    [
      "a nested object sibling (meta wrapper)",
      `{"kty":"EC","d":"${"B".repeat(43)}","meta":{"src":"vault"}}`,
    ],
    [
      "an object over 4096 chars",
      `{"kty":"RSA","d":"${"B".repeat(43)}","x5c":["${"C".repeat(4200)}"]}`,
    ],
  ])("jwk_private_key does NOT match %s (disclosed)", (_l, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });

  it("putty_private_key pins the MAC hex length", () => {
    const short = "PuTTY-User-Key-File-3: x\nPrivate-MAC: abc";
    expect(redactWithFindings(short).redacted).toBe(short);
  });

  // DISCLOSED over-redaction: nothing requires the span to be a file.
  it("putty_private_key consumes prose naming both anchors (disclosed)", () => {
    const doc =
      "PuTTY-User-Key-File-3: we now support ed25519.\nThe last line is a\nPrivate-MAC: 0123456789abcdef checksum.";
    expect(redactWithFindings(doc).redacted).toContain("[REDACTED PUTTY PRIVATE KEY]");
  });
});

describe("credential carriers beyond key files", () => {
  it.each([
    [
      "AWS secret in an uppercase env assignment",
      `AWS_SECRET_ACCESS_KEY=${"A".repeat(40)}`,
      "aws_secret_key",
    ],
    [
      "AWS session token",
      "aws_session_token = FwoGZXIvYXdzEBYaDGxvbmdzZXNzaW9udG9rZW52YWx1ZWhlcmU=",
      "aws_session_token",
    ],
    [
      "gcloud refresh token",
      `{"refresh_token":"1//0gLongRefreshTokenValueHere12345678"}`,
      "json_secret_field",
    ],
    [
      "Azure client secret",
      `{"clientSecret":"Q~AbCdEfGhIjKlMnOpQrStUvWxYz012345678"}`,
      "json_secret_field",
    ],
    [
      "docker registry auth",
      `{"auth":"aGFsaXQ6c3VwZXJzZWNyZXRwYXNzd29yZA=="}`,
      "json_secret_field",
    ],
    [
      "netrc password",
      "machine api.example.com login me password S3cr3tP@ssw0rd!xyz",
      "netrc_password",
    ],
    [
      "npm token",
      "//registry.npmjs.org/:_authToken=npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123",
      "npm_token",
    ],
    ["pypi token", "password = pypi-AgEIcHlwaS5vcmcCJDU0NmY4ZGE1LWRlYWQtYmVlZg", "pypi_token"],
    [
      "Vault client token",
      `{"client_token":"hvs.CAESIJlongtokenvaluegoeshere123456"}`,
      "vault_token",
    ],
    [
      "BIP32 extended private key",
      "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi",
      "bip32_xprv",
    ],
  ])("redacts %s", (_label, input, detector) => {
    const out = redactWithFindings(input);
    expect(out.findings.map((f) => f.name)).toContain(detector);
    expect(out.count).toBeGreaterThan(0);
  });

  it("redacts an Ansible Vault blob", () => {
    const v =
      "$ANSIBLE_VAULT;1.1;AES256\n3938306162636465666768696a6b6c6d6e6f70717273747576\n7778797a30313233343536373839";
    expect(redactWithFindings(v).findings.map((f) => f.name)).toContain("ansible_vault");
  });

  // A base64-wrapped PEM is a whole private key one `base64 -d` away — this is
  // how kubectl and kubeconfig carry them, so the armour markers never appear.
  // `LS0tLS1CRUdJTi` is the base64 of `-----BEGIN `, which makes it regexable
  // without a decode-and-rescan step.
  it("redacts a base64-wrapped PEM in a Kubernetes secret", () => {
    const k8s =
      "apiVersion: v1\nkind: Secret\ndata:\n  tls.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2Z0lCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQw==";
    const out = redactWithFindings(k8s);
    expect(out.findings.map((f) => f.name)).toContain("base64_pem_block");
    expect(out.redacted).not.toContain("LS0tLS1CRUdJTiBQUklWQVRF");
  });

  it.each([
    ["prose using the word password", "the password field is required for login"],
    ["a short JSON value", '{"refresh_token":"short"}'],
    ["an npm_ word that is not a token", "npm_modules is not a token"],
    ["prose about xprv", "an xprv key looks like this"],
    ["base64 of something else", "data: SGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBrZXkgYXQgYWxs"],
    ["a machine line with no password", "machine api.example.com login me"],
    ["a too-short session token", "aws_session_token = abc"],
  ])("does not redact %s", (_label, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });

  // `LS0tLS1CRUdJTiB` is the base64 of `-----BEGIN `, shared by EVERY armour.
  // Without these, a mutant truncating the prefix redacts base64-wrapped
  // certificates and public keys and passes the whole suite — it did.
  it.each([
    ["CERTIFICATE"],
    ["PUBLIC KEY"],
    ["RSA PUBLIC KEY"],
    ["CERTIFICATE REQUEST"],
    ["DH PARAMETERS"],
  ])("base64_pem_block does not match a base64-wrapped %s", (header) => {
    const input = Buffer.from(
      `-----BEGIN ${header}-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCabcdefghij\n`,
    ).toString("base64");
    expect(redactWithFindings(input).redacted).toBe(input);
  });

  it.each([
    ["PRIVATE KEY"],
    ["RSA PRIVATE KEY"],
    ["EC PRIVATE KEY"],
    ["OPENSSH PRIVATE KEY"],
    ["ENCRYPTED PRIVATE KEY"],
  ])("base64_pem_block redacts a base64-wrapped %s", (header) => {
    const input = Buffer.from(
      `-----BEGIN ${header}-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCabcdefghij\n`,
    ).toString("base64");
    expect(redactWithFindings(input).findings.map((f) => f.name)).toContain("base64_pem_block");
  });
});

describe("carrier detectors — behavioural bound edges and negatives", () => {
  // The nine carriers shipped with byte pins and almost no behavioural
  // assertions: 53 of 63 mutants died pin-only. A pin locks a value in; it does
  // not say the value is right — the `netrc` {6,128} ceiling died pin-only and
  // was wrong. These are the floor/ceiling and must-not-match pairs.

  it.each([
    ["floor-1", 29, false],
    ["floor", 30, true],
  ])("npm_token %s", (_l, n, want) => {
    const s = `npm_${"A".repeat(n)}`;
    expect(redactWithFindings(s).count > 0).toBe(want);
  });

  it.each([
    ["floor-1", 15, false],
    ["floor", 16, true],
  ])("pypi_token %s", (_l, n, want) => {
    const s = `pypi-${"A".repeat(n)}`;
    expect(redactWithFindings(s).count > 0).toBe(want);
  });

  it.each([
    ["floor-1", 19, false],
    ["floor", 20, true],
  ])("vault_token %s", (_l, n, want) => {
    const s = `hvs.${"A".repeat(n)}`;
    expect(redactWithFindings(s).count > 0).toBe(want);
  });

  it.each([
    ["floor-1", 39, false],
    ["floor", 40, true],
  ])("aws_session_token %s", (_l, n, want) => {
    const s = `aws_session_token = ${"A".repeat(n)}`;
    expect(redactWithFindings(s).count > 0).toBe(want);
  });

  it.each([
    ["floor-1", 15, false],
    ["floor", 16, true],
  ])("json_secret_field %s", (_l, n, want) => {
    const s = `{"auth":"${"A".repeat(n)}"}`;
    expect(redactWithFindings(s).count > 0).toBe(want);
  });

  // The public halves are not secrets and must survive. `bip32_xprv` had no
  // behavioural assertion for this at all — only its comment claimed it.
  it.each([
    [
      "xpub",
      "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8",
    ],
    [
      "ypub",
      "ypub6QqdH2c5z7967SLA6QcqGpJhqXH8mnjrgAmYGWQTGrfMfoAcqxSVjEyLQWNJPjPFYYqTeoJ1JHOO2iiYyd7XXCbGvXNXCr9EDDBvQBUlxfL",
    ],
  ])("bip32_xprv leaves the public %s alone", (_l, key) => {
    expect(redactWithFindings(key).redacted).toBe(key);
  });

  it.each([
    [
      "a header with no cipher",
      "$ANSIBLE_VAULT;1.1;\n3938306162636465666768696a6b6c6d6e6f7071727374757677",
    ],
    ["prose naming the header", "the $ANSIBLE_VAULT;1.1;AES256 header marks an encrypted file"],
  ])("ansible_vault does not match %s", (_l, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });

  // Regression fixtures for the defects this round found.
  it("aws_access_key covers the temporary ASIA prefix", () => {
    for (const p of ["AKIA", "ASIA"]) {
      expect(redactWithFindings(`${p}Y34FZKBOKMUTVV7A`).count).toBe(1);
    }
  });

  it("github_token covers fine-grained github_pat_ tokens", () => {
    // A real fine-grained PAT is `github_pat_` + 22 base62 + `_` + 59 base62.
    // The separator is structural: a fixture without it lets a mutant that
    // drops `_` from the class pass while matching zero real tokens.
    const pat = `github_pat_${"A".repeat(22)}_${"B".repeat(59)}`;
    expect(redactWithFindings(`GH_TOKEN=${pat}`).count).toBe(1);
  });

  it("a full aws sts assume-role credential set is fully redacted", () => {
    const sts = `{"Credentials":{"AccessKeyId":"ASIAY34FZKBOKMUTVV7A","SecretAccessKey":"wJalrXUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEYq","SessionToken":"IQoJb3JpZ2lu${"A".repeat(300)}"}}`;
    const out = redactWithFindings(sts);
    expect(out.count).toBeGreaterThanOrEqual(3);
    for (const secret of [
      "ASIAY34FZKBOKMUTVV7A",
      "wJalrXUtnFEMI/K7MDENGbPxRfiCYEXAMPLEKEYq",
      "IQoJb3JpZ2lu",
    ]) {
      expect(out.redacted).not.toContain(secret);
    }
  });

  it("ansible_vault covers format 1.2, which carries a vault-id field", () => {
    const v = "$ANSIBLE_VAULT;1.2;AES256;dev\n3938306162636465666768696a6b6c6d6e6f7071727374757677";
    expect(redactWithFindings(v).findings.map((f) => f.name)).toContain("ansible_vault");
  });

  it("netrc_password leaves no cleartext tail on a long password", () => {
    const out = redactWithFindings(`machine h login me password ${"S".repeat(200)}`).redacted;
    expect(out).not.toContain("SS");
  });

  it("base64_pem_block does not consume the following YAML key", () => {
    const key = Buffer.from(
      "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCabcdefghij\n",
    ).toString("base64");
    expect(redactWithFindings(`  tls.key: ${key}\ntype: kubernetes.io/tls\n`).redacted).toBe(
      "  tls.key: [REDACTED BASE64 PRIVATE KEY]\ntype: kubernetes.io/tls\n",
    );
  });

  // The ledger scrub destroyed the host of every credential-free URL with `@`
  // in its path, which is the one field firewall-report.ts groups by.
  it.each([
    ["npm i https://registry.npmjs.org/@babel/core"],
    ["curl https://cdn.jsdelivr.net/npm/@scope/pkg@1.2.3/d.js"],
    ["curl https://example.com/img/@2x.png"],
    ["curl https://medium.com/@someuser/article-slug"],
  ])("redactForLedger keeps the host of the credential-free URL %s", (input) => {
    expect(redactForLedger(input)).toBe(input);
  });
});

// The §6.4 non-vacuity gate covered only the original seven. A detector whose
// canonical positive does not match makes every other assertion about it
// meaningless — and this suite has already shipped one seed that matched nothing.
describe("non-vacuity gate — every detector in the table", () => {
  it("every REDACTION_PATTERNS entry has at least one canonical positive here", () => {
    const covered = new Set([
      "github_token",
      "anthropic_key",
      "openai_key",
      "aws_access_key",
      "aws_secret_key",
      "bearer_token",
      "jwt",
      "private_key_block",
      "ssh2_private_key_block",
      "putty_private_key",
      "age_secret_key",
      "jwk_private_key",
      "base64_pem_block",
      "ansible_vault",
      "npm_token",
      "pypi_token",
      "vault_token",
      "bip32_xprv",
      "env_value",
      "db_url",
      "url_basic_auth",
      "url_query_secret",
      "cli_secret_flag_eq",
      "cli_secret_flag_spaced",
      "api_key_header",
      "basic_auth_header",
      "aws_session_token",
      "json_secret_field",
      "netrc_password",
      "credit_card",
      "iban",
      "tr_national_id",
      "stripe_key",
      "slack_token",
      "gitlab_token",
      "sendgrid_key",
      "digitalocean_token",
      "twilio_api_key_sid",
      "connection_string_secret",
      "slack_webhook_url",
    ]);
    const shipped = REDACTION_PATTERNS.map((p) => p.name);
    expect(shipped.filter((n) => !covered.has(n))).toEqual([]);
    // Pins the table size: the wiki claimed 33 by summing two exported tables.
    expect(shipped).toHaveLength(40);
    expect(OBSERVED_PATTERNS).toHaveLength(1);
  });
});

describe("round-4 review regressions", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const KEY = `MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC${"Xy9AbCd012".repeat(180)}`;
  const wrap = (s: string, c: number) => (s.match(new RegExp(`.{1,${c}}`, "g")) ?? []).join("\n");

  // Dropping `\s` from the tail to stop it eating the next YAML key also stopped
  // it matching every WRAPPED form. `openssl base64` is 64-col and on every box;
  // GNU `base64` is 76-col and reported a finding while leaking ~97% of the key.
  it.each([
    ["PRIVATE KEY"],
    ["RSA PRIVATE KEY"],
    ["OPENSSH PRIVATE KEY"],
    ["ENCRYPTED PRIVATE KEY"],
    ["PGP SECRET KEY BLOCK"],
    ["ED25519 PRIVATE KEY"],
  ])("base64_pem_block redacts a wrapped %s at 64 and 76 columns", (header) => {
    const enc = b64(`-----BEGIN ${header}-----\n${KEY}\n-----END ${header}-----\n`);
    const probe = enc.slice(200, 260);
    for (const doc of [enc, wrap(enc, 64), wrap(enc, 76)]) {
      const out = redactWithFindings(doc).redacted;
      expect(out.replace(/\s/g, "")).not.toContain(probe);
    }
  });

  it.each([
    ["the following YAML key", "type: kubernetes.io/tls", "type:"],
    ["a sibling base64 field", "  tls.crt: LS0tLS1CRUdJTiBDRVJU", "tls.crt"],
  ])("base64_pem_block does not consume %s", (_l, trailer, keep) => {
    const enc = b64(`-----BEGIN PRIVATE KEY-----\n${KEY}\n-----END PRIVATE KEY-----\n`);
    expect(redactWithFindings(`  tls.key: ${enc}\n${trailer}\n`).redacted).toContain(keep);
  });

  // The whitespace-free value class dropped `Basic <b64>`, which nothing else
  // covers — basic_auth_header gates on the literal `authorization`, not `auth`.
  it.each([
    ['{"auth":"Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng=="}', true],
    ['{"auth":"aGFsaXQ6c3VwZXJzZWNyZXQxMjM="}', true],
    ['{"auth":"contact the administrator for access"}', false],
  ])("json_secret_field on %s", (input, shouldRedact) => {
    expect(redactWithFindings(input).count > 0).toBe(shouldRedact);
  });

  // A bare `\bdefault` is an ordinary English adjective; it matched inside
  // OpenSSL's own shipped documentation.
  it.each([
    ["The default password prompting functions are", false],
    ["sets the default password callback called when loading a PEM", false],
    ["\ndefault login me password S3cr3tPassw0rd", true],
    ["machine h login me password S3cr3tPassw0rd", true],
    ["machine h login me account acct password S3cr3tPass", true],
  ])("netrc_password on %s", (input, shouldRedact) => {
    expect(redactWithFindings(input).count > 0).toBe(shouldRedact);
  });

  // ansible_vault's vault-id field: format 1.2 only, and bounded.
  it.each([
    ["$ANSIBLE_VAULT;1.1;AES256", true],
    ["$ANSIBLE_VAULT;1.2;AES256;dev", true],
    ["$ANSIBLE_VAULT;1.2;AES256;a-very-long-vault-identifier-name-x", true],
  ])("ansible_vault accepts %s", (header, shouldRedact) => {
    const body = "3938306162636465666768696a6b6c6d6e6f70717273747576777879";
    expect(redactWithFindings(`${header}\n${body}`).count > 0).toBe(shouldRedact);
  });
});

describe("vendor and connection-string carriers", () => {
  it.each([
    ["Stripe secret", `sk_live_${"A".repeat(24)}`, "stripe_key"],
    ["Stripe restricted", `rk_live_${"A".repeat(24)}`, "stripe_key"],
    ["Slack bot", `xoxb-123456789012-${"A".repeat(24)}`, "slack_token"],
    ["GitLab PAT", `glpat-${"A".repeat(20)}`, "gitlab_token"],
    ["SendGrid", `SG.${"A".repeat(22)}.${"B".repeat(43)}`, "sendgrid_key"],
    ["DigitalOcean", `dop_v1_${"a".repeat(64)}`, "digitalocean_token"],
    ["Twilio API key", `SK${"0123456789abcdef".repeat(2)}`, "twilio_api_key_sid"],
    [
      "ODBC Password field",
      "Server=tcp:h,1433;Database=prod;Password=Pl4inTextOdbcPassw0rdZZ;Encrypt=True",
      "connection_string_secret",
    ],
    [
      "Azure AccountKey",
      `DefaultEndpointsProtocol=https;AccountName=p;AccountKey=${"A".repeat(86)}==;EndpointSuffix=core`,
      "connection_string_secret",
    ],
  ])("redacts a %s", (_l, input, detector) => {
    expect(redactWithFindings(input).findings.map((f) => f.name)).toContain(detector);
  });

  // `pk_` is Stripe's PUBLISHABLE key — not a secret, and redacting it would be
  // evidence loss. This is the row that keeps `sk|rk` from becoming `[a-z]{2}`.
  it.each([[`pk_live_${"A".repeat(24)}`], [`pk_test_${"A".repeat(24)}`]])(
    "leaves the Stripe publishable key %s alone",
    (input) => {
      expect(redactWithFindings(input).redacted).toBe(input);
    },
  );

  it.each([
    ["a documented field name with no value", "the Password= field is documented below"],
    ["a short connection-string value", "Server=h;Password=short;X=1"],
    ["a truncated Slack prefix", "xoxb-123"],
    ["prose mentioning SK", "the SK identifier appears in the docs"],
  ])("does not redact %s", (_l, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });

  // Field-name gate, not a bare long value: the value must stop at the next `;`
  // so the rest of the connection string survives as evidence.
  it("keeps the connection string readable around the redacted value", () => {
    // The field NAME survives — only the value is replaced — so a reader can
    // still see which field was scrubbed and the rest of the string is intact.
    expect(redactWithFindings("Server=h;Password=Sup3rSecretPw;Encrypt=True").redacted).toBe(
      "Server=h;Password=[REDACTED];Encrypt=True",
    );
  });

  it.each([
    ["floor-1", 15, false],
    ["floor", 16, true],
  ])("stripe_key at %s", (_l, n, want) => {
    expect(redactWithFindings(`sk_live_${"A".repeat(n)}`).count > 0).toBe(want);
  });

  it.each([
    ["floor-1", 7, false],
    ["floor", 8, true],
  ])("connection_string_secret value at %s", (_l, n, want) => {
    expect(redactWithFindings(`Server=h;Password=${"P".repeat(n)};X=1`).count > 0).toBe(want);
  });

  // `openai_key` is `sk-`, Stripe is `sk_`. Neither may claim the other.
  it("stripe_key and openai_key do not claim each other", () => {
    expect(redactWithFindings(`sk_live_${"A".repeat(24)}`).findings.map((f) => f.name)).toEqual([
      "stripe_key",
    ]);
    expect(redactWithFindings(`sk-${"A".repeat(24)}`).findings.map((f) => f.name)).toEqual([
      "openai_key",
    ]);
  });
});

// ── the three gaps spec §5b disclosed and left open ──────────────────────────
// Every fixture here measured `fired: (none)` against 769d7efd. The controls
// below redact on that commit, so they cannot be what turns this block green —
// they are here to catch a regression that kills a detector outright.
describe("residual carriers disclosed in spec §5b", () => {
  const HOOK = "aBcDeFgHiJkLmNoPqRsTuVwX";

  it.each([
    ["services", `POST https://hooks.slack.com/services/T00000000/B00000000/${HOOK}`],
    ["workflows", `https://hooks.slack.com/workflows/T0000/A0000/1234567890/${HOOK}`],
    ["triggers", `https://hooks.slack.com/triggers/T0000/1234567890/${HOOK}`],
    ["plaintext http", `http://hooks.slack.com/services/T0/B0/${HOOK}`],
  ])("redacts a Slack %s webhook URL", (_l, input) => {
    const { redacted, findings } = redactWithFindings(input);
    expect(findings.map((f) => f.name)).toContain("slack_webhook_url");
    expect(redacted).not.toContain(HOOK);
  });

  // Host and endpoint kind stay readable: report grouping needs a host, and a
  // reader needs to know which Slack surface leaked. Same reason
  // `url_basic_auth` keeps its host and `sendgrid_key` keeps `SG.`.
  it("keeps the Slack host and endpoint kind out of the redaction", () => {
    expect(
      redactWithFindings(`https://hooks.slack.com/services/T00000000/B00000000/${HOOK}`).redacted,
    ).toBe("https://hooks.slack.com/services/[REDACTED]");
  });

  it.each([
    ["glrtr", "glrtr-"],
    ["glft", "glft-"],
    ["glffct", "glffct-"],
    ["glimt", "glimt-"],
    ["glsoat", "glsoat-"],
    ["glagent", "glagent-"],
    ["glwt", "glwt-"],
  ])("redacts a GitLab %s- token", (_l, prefix) => {
    const body = "A".repeat(20);
    const { redacted, findings } = redactWithFindings(`token=${prefix}${body}`);
    expect(findings.map((f) => f.name)).toContain("gitlab_token");
    expect(redacted).not.toContain(body);
  });

  const PW = "Pl4inTextOdbcPassw0rdZZ";

  it.each([
    ["a space after the ; separator", `Server=tcp:h,1433; Password=${PW};Encrypt=True`],
    ["spaces around the = sign", `Server=tcp:h,1433;Password = ${PW};Encrypt=True`],
    ["a newline after the ; separator", `Server=tcp:h,1433;\nPassword=${PW};\nEncrypt=True`],
    ["a newline plus indent", `Server=tcp:h,1433;\n    Password=${PW};`],
  ])("redacts a connection-string password with %s", (_l, input) => {
    const { redacted, findings } = redactWithFindings(input);
    expect(findings.map((f) => f.name)).toContain("connection_string_secret");
    expect(redacted).not.toContain(PW);
  });

  // ADO.NET quotes a value that legally contains the `;` delimiter. Before this
  // change the body saw `"pw` — three characters, under the 8-char floor — so
  // NOTHING matched: not a shortened redaction, no finding at all, and the whole
  // password leaked including the segment before the first delimiter.
  it.each([
    ["double", `Server=a;Password="pw;with;semis;ZZZZ";Encrypt=True`],
    ["single", `Server=a;Password='pw;with;semis;ZZZZ';Encrypt=True`],
  ])("redacts a %s-quoted value containing the ; delimiter", (_l, input) => {
    const { redacted, findings } = redactWithFindings(input);
    expect(findings.map((f) => f.name)).toContain("connection_string_secret");
    expect(redacted).not.toContain("semis");
    expect(redacted).toContain("Server=a");
    expect(redacted).toContain("Encrypt=True");
  });

  it.each([
    ["glpat", `token=glpat-${"A".repeat(20)}`, "gitlab_token"],
    ["bare ;Password=", `Server=h;Password=${PW};X=1`, "connection_string_secret"],
  ])("control: %s still redacts", (_l, input, detector) => {
    expect(redactWithFindings(input).findings.map((f) => f.name)).toContain(detector);
  });

  // Over-redaction, not under: a value whose closing quote is missing lets the
  // run reach the NEXT quote in the input, taking the following field name with
  // it. Malformed input, and erring toward redacting more is the safe direction
  // — but it is a behaviour, so it is pinned rather than left to surprise.
  it("an unterminated quote swallows the following field, capped by the bound", () => {
    const out = redactWithFindings(`a=1;Password="unterminated;Other=${"z".repeat(12)}";b=2`);
    expect(out.findings.map((f) => f.name)).toContain("connection_string_secret");
    expect(out.redacted).toBe("a=1;Password=[REDACTED];b=2");
  });

  // A quoted value OVER the bound falls through to the unquoted alternative,
  // which is unbounded — so length alone never leaks. Only length AND a `;`
  // inside do, because the unquoted run stops at the delimiter.
  it("a quoted value over the bound is still redacted when it holds no ;", () => {
    expect(redactWithFindings(`a=1;Password="${"q".repeat(9000)}";b=2`).redacted).toBe(
      "a=1;Password=[REDACTED];b=2",
    );
  });

  it.each([
    ["at the bound", 8000, true],
    ["over the bound", 9000, false],
  ])("a ;-bearing quoted value %s is redacted: %s", (_l, len, want) => {
    const input = `a=1;Password="qqqqqqqqqq;${"r".repeat(len)}";b=2`;
    expect(!redactWithFindings(input).redacted.includes("r".repeat(20))).toBe(want);
  });

  // Disclosed losses this change CREATES — spec §5. Pinning them keeps a later
  // widening honest: if one of these starts redacting, a bound moved.
  it.each([
    [
      "nine spaces before the =, over the 8-char gap bound",
      `Server=h;Password${" ".repeat(9)}=${PW};X=1`,
    ],
    ["a quoted value under the 8-char floor", `Server=h;Password="ab";X=1`],
    ["a Slack webhook path under the 16-char floor", "https://hooks.slack.com/services/T0/B0/x"],
  ])("disclosed loss: does not redact %s", (_l, input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });
});

describe("carrier detectors — the mutants only a pin was catching", () => {
  // A CEILING mutant is the one with real teeth: it still MATCHES, so it redacts
  // the first N characters, leaves the rest, and reports a finding. Green signal
  // over a live key — the same failure `base64_pem_block` already records. Every
  // other fixture sits at or below any plausible ceiling, so none can see it.
  it.each([
    ["stripe_key", `sk_live_${"K".repeat(99)}`],
    ["slack_token", `xoxb-${"K".repeat(99)}`],
    ["gitlab_token", `glpat-${"K".repeat(99)}`],
  ])("%s redacts a long value WHOLE, leaving no tail", (_name, input) => {
    const out = redactWithFindings(input).redacted;
    expect(out).not.toMatch(/K{8}|b{8}/);
  });

  // `[^;\s]` not `[^;]`: without the whitespace exclusion a value swallows
  // spaces and newlines up to the next `;`, eating whatever follows on the line.
  it("connection_string_secret stops at whitespace, not just at the next ;", () => {
    expect(redactWithFindings("Server=h;Password=Sup3rSecret and then prose;X=1").redacted).toBe(
      "Server=h;Password=[REDACTED] and then prose;X=1",
    );
  });

  // Three of the six field names had no behavioural coverage at all.
  it.each([["sharedaccesskey"], ["sharedaccesssignature"], ["userpassword"]])(
    "connection_string_secret gates on the %s field",
    (field) => {
      expect(redactWithFindings(`Server=h;${field}=Sup3rSecretValue;X=1`).count).toBe(1);
    },
  );

  // `PWD` is the universal shell variable — every env dump and CI log has one.
  // This is why the separator gate is `(?:^|;)` and not `[;\s]`.
  it.each([
    ["PWD=/Users/x/Desktop/project"],
    ["SHELL=/bin/zsh\nPWD=/Users/x/proj\nTERM=xterm"],
    ["OLDPWD=/tmp"],
  ])("connection_string_secret leaves the shell variable in %s alone", (input) => {
    expect(redactWithFindings(input).redacted).toBe(input);
  });
});

// ─── public surface ──────────────────────────────────────────────────────────
//
// Everything above tests regexes. Nothing above calls redact*(), which left
// redact.ts completely unfenced: a `if (text.length > 200_000) return …` size
// gate inserted into redactWithFindings passed all 259 tests, sending every
// secret in a capture over 200 KB to the agent in cleartext. These close that.

describe("public surface — redactWithFindings / redactForLedger", () => {
  it("scans the whole input, not a truncated prefix", () => {
    // 300 KB of filler, secret LAST. A size gate or an early-return makes this
    // find nothing. Fixed patterns make the scan cheap enough to be routine.
    const input = `${"x".repeat(300 * 1024)}\naws_secret_access_key = ${"A".repeat(40)}`;
    const result = redactWithFindings(input);
    expect(result.findings).toEqual([{ name: "aws_secret_key", count: 1 }]);
    expect(result.redacted).not.toContain("A".repeat(40));
  });

  it("finds every detector this change touched in one pass", () => {
    const input = [
      `aws_secret_access_key = ${"A".repeat(40)}`,
      "Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l",
      "x-api-key: abcdef123456",
      "postgres://app:s3cret@db.internal:5432/prod",
      "https://u:p@api.example.com/v1",
      pem(3200),
    ].join("\n");
    const { redacted, count } = redactWithFindings(input);
    expect(count).toBe(6);
    for (const secret of ["A".repeat(40), "QWxhZGRpbjpvcGVuc2VzYW1l", "abcdef123456", "s3cret"]) {
      expect(redacted).not.toContain(secret);
    }
  });

  // redact.ts:49-51 — this value must NEVER persist into a ledger sourcePath
  // label (F-FW-1). Containment must NOT depend on the agent-path bounds:
  // before the ledger scrub, an over-bound password left 97% of itself here,
  // because email's then-unbounded local part had been the accidental backstop.
  it.each([100, 2000, 8192, 8193, 40_000])(
    "keeps a %s-char URL password out of the ledger entirely",
    (length) => {
      const password = "p".repeat(length);
      const out = redactForLedger(`curl https://svc:${password}@host.example.com/v1`);
      expect(out).not.toContain("pp");
      expect(out.length).toBeLessThan(64);
    },
  );

  // Two key blocks with a log line between them. Dropping the lazy `?` from the
  // body makes it greedy: ONE match spanning both keys, so `count` reports 1
  // instead of 2 (against the contract at redaction-patterns.ts) and the text
  // between the keys is destroyed. Every single-block fixture is blind to it —
  // this is the only assertion that pins laziness behaviourally.
  it("redacts two key blocks separately and preserves the text between them", () => {
    const between = "\n2026-07-25T10:00:00Z INFO rotation complete, 2 keys replaced\n";
    const input = `${pem(256)}${between}${pem(256, "EC ")}`;
    const { redacted, count } = redactWithFindings(input);
    expect(count).toBe(2);
    expect(redacted).toBe(`[REDACTED PRIVATE KEY]${between}[REDACTED PRIVATE KEY]`);
  });

  it("scrubs an @-bearing password whole and keeps the host for report grouping", () => {
    expect(redactForLedger("git clone https://user:p@ss@github.com/org/repo.git")).toBe(
      "git clone https://[REDACTED]@github.com/org/repo.git",
    );
  });

  it("leaves an ordinary path untouched", () => {
    expect(redactForLedger("/Users/x/project/src/deep/path/file.ts")).toBe(
      "/Users/x/project/src/deep/path/file.ts",
    );
  });

  it("still scrubs emails, which the agent-visible path only counts", () => {
    expect(redactForLedger("mega run --author alice@example.com")).toBe(
      "mega run --author [REDACTED:email]",
    );
    expect(redactWithFindings("alice@example.com").redacted).toBe("alice@example.com");
  });
});

// ─── §6.3 timing ─────────────────────────────────────────────────────────────
//
// Two instruments, chosen per pattern by measured separation:
//
//   ceiling — where fixed and broken differ by >=1000x. Simple and stable.
//   ratio   — where they do not. private_key_block costs the SAME at 200 KB
//             before and after (the bound only binds as n grows), so a ceiling
//             there would flag the FIX; and fixed url_basic_auth is only ~7x
//             under broken, too thin for CI.
//
// Neither instrument alone is safe. A ceiling-only suite passes the two above.
// A ratio-only suite passes a broken aws_secret_key, which flattens to x1.4
// once it is slow enough to hit thermal limits.
//
// retry per the jwt spec §6.2a: a reintroduced quadratic is slow on every
// attempt, so retries cost no discriminating power. They are load-bearing here
// — the url_basic_auth ratio runs ~3% under threshold on a busy box.

const KB = 1024;
const CEILING_MS = 500;
const MAX_GROWTH = 3.0; // fixed measures 1.6-2.4x; broken 3.8-7.5x
const FLOOR_MS = 5; // below this a ratio measures the scheduler, not the pattern

const measure = (name: string, input: string): number => {
  const { pattern } = entry(name);
  const compiled = () => new RegExp(pattern.source, pattern.flags);
  input.replace(compiled(), (m) => m); // warm-up, discarded
  const runs: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const re = compiled(); // built OUTSIDE the timed region
    const started = process.hrtime.bigint();
    input.replace(re, (m) => m);
    runs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  // min, not median: at multi-second rungs the noise is one-sided (background
  // load, thermal), so the minimum is the robust estimator — the same choice
  // scripts/redos-probe.mjs makes and documents. Median-of-3 made the
  // putty_private_key gate fail all four retries at 3.3-4.1x while min-of-15 on
  // the same seed measured 1.90-2.02x.
  return Math.min(...runs);
};

const SEEDS: Record<string, (bytes: number) => string> = {
  aws_secret_key: (n) => " ".repeat(n),
  api_key_header: (n) => " ".repeat(n),
  basic_auth_header: (n) => " ".repeat(n),
  db_url: (n) => `postgres://a${":".repeat(n)}`,
  // NOT 'ht://a:b' + 'b'.repeat(n) — that earlier published repro is linear and
  // passes against the UNFIXED pattern. Spec §1d.
  url_basic_auth: (n) => "x://a:b/".repeat(Math.ceil(n / 8)),
  private_key_block: (n) => "-----BEGIN A PRIVATE KEY-----".repeat(Math.ceil(n / 29)),
  email: (n) => "X".repeat(n),
  // Detectors added 2026-07-25. Each seed is a run of that format's opening
  // anchor with no terminator, so every occurrence is a start position that
  // scans to the bound — the shape that made private_key_block expensive.
  ssh2_private_key_block: (n) =>
    "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----".repeat(Math.ceil(n / 42)),
  putty_private_key: (n) => "PuTTY-User-Key-File-3: ssh-ed25519\n".repeat(Math.ceil(n / 35)),
  // Must actually MATCH: "AGE-SECRET-KEY-1".repeat() never forms a 50-char
  // [0-9A-Z] run, because `-` terminates the class — that seed measured a
  // pattern that never fires. 16-byte prefix + 60 body chars per key.
  age_secret_key: (n) => `AGE-SECRET-KEY-1${"Q".repeat(60)}`.repeat(Math.ceil(n / 76)),
  // kty present, private field absent: forces BOTH lookaheads to scan and fail.
  jwk_private_key: (n) => `{"kty":"RSA","n":"${"x".repeat(200)}"}`.repeat(Math.ceil(n / 220)),
};

const seed = (name: string, bytes: number): string => {
  const make = SEEDS[name];
  if (make === undefined) throw new Error(`no seed for ${name}`);
  return make(bytes);
};

describe("linear time on the adversarial seed (spec §6.3)", () => {
  // Measured broken at 100 KB: 4,269-15,023 ms. Fixed: 0.2-13 ms.
  it.each([
    "aws_secret_key",
    "api_key_header",
    "basic_auth_header",
    "db_url",
    "email",
    "age_secret_key",
    "jwk_private_key",
  ])(
    "%s stays under the ceiling at 100 KB",
    (name) => {
      expect(measure(name, seed(name, 100 * KB))).toBeLessThan(CEILING_MS);
    },
    { retry: 3, timeout: 300_000 },
  );

  // Rungs kept low deliberately: broken is 3.8-7.5x at every size, so small
  // rungs discriminate just as well and cost the suite a quarter of the time.
  // private_key_block runs at 256/512 KB rather than 128/256: a review asked for
  // a rung above 1 MB so a regression that only appears there cannot pass CI.
  // 1 MB was rejected on suite time (~3 s per measurement, x4 under retry) and
  // because the bound already binds from ~64 KB — a bound-raise regression, the
  // realistic >1 MB shape, diverges well below these rungs. 512 KB is the
  // compromise; the harness covers 1 MB and 4 MB out of band.
  it.each([
    ["url_basic_auth", 64 * KB],
    ["private_key_block", 256 * KB],
    ["ssh2_private_key_block", 256 * KB],
    ["putty_private_key", 256 * KB],
  ])(
    "%s grows linearly, not quadratically",
    (name, base) => {
      const small = measure(name, seed(name, base));
      const large = measure(name, seed(name, base * 2));
      // A lower bound on runtime would fail when the code gets FASTER, so the
      // sub-floor case asserts cheapness instead of a ratio.
      if (large < FLOOR_MS) expect(large).toBeLessThan(FLOOR_MS);
      else expect(large / small).toBeLessThan(MAX_GROWTH);
    },
    { retry: 3, timeout: 300_000 },
  );

  // Widening the label to `[A-Z ]*` and allowing ` BLOCK` turns two previously
  // NON-matching shapes into real start positions, each now scanning forward to
  // the 32768 bound. Measured, that moves them from ~0.4 ms to ~650/466 ms at
  // 400 KB — the accepted price of closing a cleartext leak on the most common
  // private-key format. What must not happen is that they go super-linear.
  it.each([
    ["PKCS#8", "-----BEGIN PRIVATE KEY-----"],
    ["PGP", "-----BEGIN PGP PRIVATE KEY BLOCK-----"],
  ])(
    "a run of %s BEGIN markers with no END grows linearly",
    (_label, marker) => {
      const at = (bytes: number) =>
        measure("private_key_block", marker.repeat(Math.ceil(bytes / marker.length)));
      const small = at(128 * KB);
      const large = at(256 * KB);
      if (large < FLOOR_MS) expect(large).toBeLessThan(FLOOR_MS);
      else expect(large / small).toBeLessThan(MAX_GROWTH);
    },
    { retry: 3, timeout: 300_000 },
  );

  it(
    "the whole pipeline is linear on the worst seed",
    () => {
      const at = (bytes: number) => {
        const input = seed("private_key_block", bytes);
        const started = process.hrtime.bigint();
        redactWithFindings(input);
        return Number(process.hrtime.bigint() - started) / 1e6;
      };
      at(64 * KB); // warm-up
      const small = at(128 * KB);
      const large = at(256 * KB);
      expect(large / small).toBeLessThan(MAX_GROWTH);
    },
    { retry: 3, timeout: 300_000 },
  );
});

// ─── §6.4 non-vacuity ────────────────────────────────────────────────────────
//
// The first differential fuzz written for this spec used random strings and
// reported matched=0 for six of seven patterns — random text never manufactures
// 'aws_secret_access_key=' or '-----BEGIN … PRIVATE KEY-----'. It reported zero
// divergences, which meant nothing. Assert a corpus matched before trusting it.

describe("non-vacuity gate (spec §6.4)", () => {
  it.each([
    ["aws_secret_key", `aws_secret_access_key = ${"A".repeat(40)}`],
    ["api_key_header", "x-api-key: abcdef123456"],
    ["basic_auth_header", "Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l"],
    ["db_url", "postgres://u:p@host/db"],
    ["url_basic_auth", "https://u:p@host/x"],
    ["private_key_block", pem(64)],
    ["email", "alice@example.com"],
  ])("%s matches its own canonical positive", (name, input) => {
    expect(apply(name, input)).not.toBe(input);
  });
});
