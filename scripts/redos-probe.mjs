#!/usr/bin/env node
// Reproduces every measurement cited by
// docs/superpowers/specs/2026-07-25-redaction-superlinear-patterns-design.md.
//
//   node scripts/redos-probe.mjs timing     per-pattern before/after, growth per doubling
//   node scripts/redos-probe.mjs fuzz       seeded differential corpus, divergence counts
//   node scripts/redos-probe.mjs bounds     bound sweeps behind the chosen values
//   node scripts/redos-probe.mjs labels     label-form cost vs OpenSSL label coverage
//   node scripts/redos-probe.mjs carriers   growth for the 2026-07-26 carrier residuals     label-form cost vs OpenSSL label coverage
//
// Absolute milliseconds vary by 1.5x or more run to run on the same box
// (thermal, other load) and several times across Node versions. GROWTH PER
// DOUBLING is the load-bearing figure and is runtime-independent — quote that,
// not the constants. The suite in packages/policy/test/redact-superlinear.test.ts
// asserts growth for exactly this reason.
//
// Every fuzz generator here is SEEDED: each input is built around a real anchor
// for the pattern under test. A corpus of random strings reports zero
// divergences because it never manufactures `aws_secret_access_key=` or
// `-----BEGIN … PRIVATE KEY-----` and therefore never matches anything. Each
// row prints its match count; a row whose count is 0 proves nothing.

import os from "node:os";
import { pathToFileURL } from "node:url";

const KB = 1024;
const mode = process.argv[2] ?? "timing";

// ─── patterns: HEAD (before) vs shipped (after) ───────────────────────────────
//
// The `after` side of both tables is TRANSCRIBED from
// packages/policy/src/redaction-patterns.ts. A drifted copy does not fail — it
// benchmarks a pattern that does not ship and the number lands in a spec
// looking real. `packages/policy/test/redos-probe-parity.test.ts` imports AFTER
// and NEW_DETECTORS and compares them byte for byte against the shipped table,
// so editing a regex there without editing it here fails CI.
//
// BEFORE and CARRIER_BEFORE are exempt and stay unexported: they hold the
// superseded patterns, whose purpose is to differ from what ships.

const BEFORE = {
  aws_secret_key: /(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/g,
  api_key_header:
    /(?<=(?:x-api-key|x-auth-token|x-access-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s"']{8,})/gi,
  basic_auth_header: /(?<=authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]{8,}/gi,
  db_url: /(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/]+:[^\s@]+@\S+/g,
  url_basic_auth:
    /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/?#:]*:[^\s?#]+?(?=@(?:[^\s/?#@:]+(?:[/?#:]|$)|\s|$))/gi,
  private_key_block: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
};

export const AFTER = {
  aws_secret_key: /(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/gi,
  api_key_header:
    /(?=\S)(?<=(?:x-api-key|x-auth-token|x-access-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s"']{8,})/gi,
  basic_auth_header: /(?=[A-Za-z0-9+/=])(?<=authorization\s*[:=]\s*basic\s+)[A-Za-z0-9+/=]{8,}/gi,
  db_url: /(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/]{1,256}:[^\s@]{1,8192}@\S+/g,
  url_basic_auth:
    /(?<=[a-z][a-z0-9+.-]*:\/\/)[^\s/?#:]*:[^\s?#]{1,8192}?(?=@(?:[^\s/?#@:]+(?:[/?#:]|$)|\s|$))/gi,
  private_key_block:
    /-----BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\s\S]{1,32768}?-----END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----/g,
  email: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
};

// Shapes that the label widening turned from non-matching into real start
// positions. They were free before and are priced now; what matters is that they
// stay linear. Reported by `timing` alongside the main table.
const EXTRA_PK_SEEDS = {
  "private_key_block (PKCS#8 run)": (n) => "-----BEGIN PRIVATE KEY-----".repeat(Math.ceil(n / 27)),
  "private_key_block (PGP run)": (n) =>
    "-----BEGIN PGP PRIVATE KEY BLOCK-----".repeat(Math.ceil(n / 37)),
  "private_key_block (PGP SECRET)": (n) =>
    "-----BEGIN PGP SECRET KEY BLOCK-----".repeat(Math.ceil(n / 36)),
};

// Detectors with no "before" — added 2026-07-25 for private-key carriers that
// are not PEM-armoured. Reported separately since there is nothing to compare to.
export const NEW_DETECTORS = {
  ssh2_private_key_block: {
    re: /---- BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----[\s\S]{1,32768}?---- END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*PRIVATE KEY ----/g,
    seed: (n) => "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----".repeat(Math.ceil(n / 42)),
  },
  putty_private_key: {
    re: /PuTTY-User-Key-File-\d{1,2}:[\s\S]{1,8192}?Private-MAC:[ \t]*[0-9a-fA-F]{16,128}/g,
    seed: (n) => "PuTTY-User-Key-File-3: ssh-ed25519\n".repeat(Math.ceil(n / 35)),
  },
  age_secret_key: {
    re: /AGE-SECRET-KEY-1[0-9A-Z]{50,120}/g,
    // `-` terminates [0-9A-Z], so the bare-prefix repeat never forms the 50-char
    // run and matched 0 times. Corrected in the test file and missed here.
    seed: (n) => `AGE-SECRET-KEY-1${"Q".repeat(60)}`.repeat(Math.ceil(n / 76)),
  },
  aws_session_token: {
    re: /(?=[A-Za-z0-9/+=])(?<=aws_session_token\s*[:=]\s*)[A-Za-z0-9/+=]{40,}/gi,
    seed: (n) => " ".repeat(n),
  },
  json_secret_field: {
    re: /(?=[^"\\\s])(?<="(?:refresh_?token|client_?secret|identity_?token|private_key_?id|secret_?access_?key|session_?token|auth)"\s*:\s*")(?:(?:Basic|Bearer|Digest|Token) )?[^"\\\s]{16,}/gi,
    seed: (n) => '"auth":"'.repeat(Math.ceil(n / 8)),
  },
  netrc_password: {
    re: /(?=\S)(?<=(?:\bmachine\s{1,8}\S{1,253}|[\r\n][ \t]{0,8}default)\s{1,8}(?:(?:login|account)\s{1,8}\S{1,64}\s{1,8}){0,2}password\s{1,8})\S{6,}/g,
    seed: (n) => "machine h password ".repeat(Math.ceil(n / 19)),
  },
  // Seeds must MATCH. `"npm_".repeat()` never forms a 30-char [A-Za-z0-9] run
  // because `_` terminates the class, so that row measured nothing.
  npm_token: {
    re: /npm_[A-Za-z0-9]{30,}/g,
    seed: (n) => `npm_${"A".repeat(36)}`.repeat(Math.ceil(n / 40)),
  },
  pypi_token: {
    re: /pypi-[A-Za-z0-9_-]{16,}/g,
    seed: (n) => `pypi-${"A".repeat(24)}`.repeat(Math.ceil(n / 29)),
  },
  vault_token: {
    re: /hv[sb]\.[A-Za-z0-9_-]{20,}/g,
    seed: (n) => `hvs.${"A".repeat(28)}`.repeat(Math.ceil(n / 32)),
  },
  ansible_vault: {
    re: /\$ANSIBLE_VAULT;[\d.]{1,8};[A-Z0-9]{3,32}(?:;[\w.-]{1,64})?[\s0-9a-f]{32,65536}/g,
    // Header + hex body, so the row measures the tail scan. The bare header
    // repeated matched 0 times — the third time that failure shipped here.
    seed: (n) =>
      "$ANSIBLE_VAULT;1.1;AES256\n3938306162636465666768696a6b6c6d6e6f7071727374757677\n".repeat(
        Math.ceil(n / 78),
      ),
  },
  bip32_xprv: {
    re: /[xyz]prv[A-HJ-NP-Za-km-z1-9]{95,120}/g,
    seed: (n) => "xprv".repeat(Math.ceil(n / 4)),
  },
  base64_pem_block: {
    re: /LS0tLS1CRUdJTiB[A-Za-z0-9+/=]{0,64}(?:UklWQVRFIEtF|VkFURSBL|SVZBVEUgS0VZ|RUNSRVQgS0VZ|UkVUIEtF|Q1JFVCBL)[A-Za-z0-9+/=]{16,65536}(?:[\r\n]{1,2}[ \t]{0,8}[A-Za-z0-9+/=]{16,65536}){0,4096}/g,
    // prefix present, phase slice absent: forces the bounded window to scan and fail
    seed: (n) => "LS0tLS1CRUdJTiB".repeat(Math.ceil(n / 15)),
  },
  stripe_key: {
    re: /(?:(?:sk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{16,}/g,
    seed: (n) => `sk_live_${"A".repeat(24)}`.repeat(Math.ceil(n / 32)),
  },
  slack_token: {
    re: /(?:xox[baprse]|xapp)-[A-Za-z0-9-]{10,}/g,
    seed: (n) => "xoxb-".repeat(Math.ceil(n / 5)),
  },
  gitlab_token: {
    re: /gl(?:pat|oas|rtr|rt|dt|cbt|ptt|ft|ffct|imt|soat|agent|wt)-[A-Za-z0-9_-]{20,}/g,
    seed: (n) => "glpat-".repeat(Math.ceil(n / 6)),
  },
  sendgrid_key: {
    re: /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    // "SG." alone dies at 2 chars — below the 16 floor — so it never scans.
    // This gives seg1 a full run and seg2 a near-miss, which is the shape whose
    // backtracking we care about.
    seed: (n) => `SG.${"A".repeat(20)}.${"B".repeat(8)} `.repeat(Math.ceil(n / 32)),
  },
  digitalocean_token: {
    re: /do[opr]_v1_[a-f0-9]{64}/g,
    seed: (n) => "dop_v1_".repeat(Math.ceil(n / 7)),
  },
  twilio_api_key_sid: {
    re: /\bSK[0-9a-f]{32}\b/g,
    // "SK" alone has no hex to scan. 31 hex is one short of the required 32.
    seed: (n) => `SK${"0123456789abcdef".repeat(2).slice(0, 31)} `.repeat(Math.ceil(n / 34)),
  },
  connection_string_secret: {
    re: /(?=[^;\s])(?<=(?:^|;)\s{0,8}(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)\s{0,8}=\s{0,8})(?:"[^"]{8,8192}"|'[^']{8,8192}'|[^;\s]{8,})/gi,
    // ";password=" is rejected by the `(?=[^;\\s])` guard at EVERY position,
    // because the char after each `=` is `;` — the row was a guard test that
    // could not fail, and never walked the lookbehind the guard protects.
    seed: (n) => "password=1234567;".repeat(Math.ceil(n / 17)),
  },
  // Anchor-scan seed: after `services/` comes `https`, and `:` is outside the
  // body class, so the 5-char run is under the 16 floor. Every anchor is paid
  // for and none matches — the maximal cost for this shape.
  slack_webhook_url: {
    re: /(?=[A-Za-z0-9/_-])(?<=https?:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]{16,}/g,
    seed: (n) => "https://hooks.slack.com/services/".repeat(Math.ceil(n / 33)),
  },
  jwk_private_key: {
    re: /\{(?=[^{}]{0,4096}"kty"\s*:\s*"(?:RSA|EC|OKP|oct)")(?=[^{}]{0,4096}"(?:d|k)"\s*:\s*"[A-Za-z0-9_-]{20,}")[^{}]{1,4096}\}/g,
    // kty present, private field absent: forces both lookaheads to scan and fail
    seed: (n) => `{"kty":"RSA","n":"${"x".repeat(200)}"}`.repeat(Math.ceil(n / 220)),
  },
  // Home credential stores, added 2026-07-25. Each seed MATCHES — a corpus with
  // no anchor reports zero divergences and proves nothing, which has shipped
  // here three times.
  npmrc_auth: {
    re: /(?=\S)(?<=_(?:authtoken|auth|password)[ \t]{0,8}=[ \t]{0,8}["']?)[^\s"']{8,4096}/gi,
    seed: (n) => `_authToken=${"A".repeat(24)} `.repeat(Math.ceil(n / 36)),
  },
  pgpass_line: {
    re: /(?=\S)(?<=^[^\s:]{1,253}:\d{1,5}:[^\s:]{1,64}:[^\s:]{1,64}:)(?:\\[^\r\n]|[^\s:\\]){1,512}(?=[ \t]{0,8}$)/gm,
    seed: (n) => `h.internal:5432:db:user:${"A".repeat(24)}\n`.repeat(Math.ceil(n / 49)),
  },
  kubeconfig_token: {
    re: /(?=\S)(?<=^[ \t]{0,32}(?:token|id-token|refresh-token):[ \t]{1,8})[A-Za-z0-9._~+/=-]{16,4096}(?=[ \t]{0,8}$)/gim,
    seed: (n) => `    token: ${"A".repeat(24)}\n`.repeat(Math.ceil(n / 36)),
  },
};

// The adversarial seed per pattern. NOTE url_basic_auth: an earlier published
// repro, `'ht://a:b' + 'b'.repeat(n)`, is LINEAR and passes against the unfixed
// pattern — use this one or the regression is invisible.
const SEEDS = {
  aws_secret_key: (n) => " ".repeat(n),
  api_key_header: (n) => " ".repeat(n),
  basic_auth_header: (n) => " ".repeat(n),
  db_url: (n) => `postgres://a${":".repeat(n)}`,
  url_basic_auth: (n) => "x://a:b/".repeat(Math.ceil(n / 8)),
  private_key_block: (n) => "-----BEGIN A PRIVATE KEY-----".repeat(Math.ceil(n / 29)),
  email: (n) => "X".repeat(n),
};

const time = (re, input) => {
  const compiled = new RegExp(re.source, re.flags);
  const started = process.hrtime.bigint();
  input.replace(compiled, (m) => m);
  return Number(process.hrtime.bigint() - started) / 1e6;
};
// min-of-3, not median: at multi-second rungs the noise is one-sided (other
// processes, thermal), so the minimum is the robust estimator. Reviewers on this
// change reported 11 s and 6 s for the same measurement on a contended box.
const median3 = (re, input) => {
  time(re, input); // warm-up
  return Math.min(time(re, input), time(re, input), time(re, input));
};
const fmt = (ms) => (ms < 10 ? ms.toFixed(2) : ms.toFixed(0)).padStart(9);

// Guard against the class of bug that shipped twice here: a seed that never
// matches makes its whole row meaningless. Anchor-scan seeds (deliberately
// match-free, to force a bounded scan that fails) are listed explicitly.
//
// SCOPE: NEW_DETECTORS only. SEEDS and EXTRA_PK_SEEDS are deliberately outside
// it. All ten of those are worst-case SCAN seeds — ` `.repeat(n),
// `postgres://a` + n colons, BEGIN markers with no END — where matching nothing
// is the intended behaviour and the cost being measured is the engine failing
// at every position. A match-count guard over them would exempt 10 of 10 and
// prove nothing, so it would be a guard in name only. Three entries naming
// EXTRA_PK_SEEDS labels used to sit in the set below and exempted nothing,
// because this function never iterated that table; the parity test now fails
// if such an entry reappears.
export const MATCH_FREE_BY_DESIGN = new Set([
  "slack_token",
  "gitlab_token",
  "sendgrid_key",
  "digitalocean_token",
  "twilio_api_key_sid",
  "connection_string_secret",
  "slack_webhook_url",
  "ssh2_private_key_block",
  "putty_private_key",
  "base64_pem_block",
  "json_secret_field",
  "aws_session_token",
  "netrc_password",
  "jwk_private_key",
]);

function assertSeedsMatch() {
  const bad = [];
  for (const [name, { re, seed }] of Object.entries(NEW_DETECTORS)) {
    if (MATCH_FREE_BY_DESIGN.has(name)) continue;
    const hits = (seed(64 * KB).match(new RegExp(re.source, re.flags)) ?? []).length;
    if (hits === 0) bad.push(name);
  }
  if (bad.length > 0) {
    console.error(`VACUOUS SEEDS (0 matches, so their rows measure nothing): ${bad.join(", ")}`);
    process.exitCode = 1;
  }
}

const benignLog = (n) =>
  (
    "  at Module._compile (node:internal/modules/cjs/loader:1234:14)\n" +
    "INFO 2026-07-25T10:00:00Z request id=abc-123 status=200 dur=14ms\n" +
    "ERROR TypeError: Cannot read properties of undefined (reading 'x')\n" +
    "user alice@example.com fetched https://api.example.com/v1/items?page=2\n" +
    "postgres://app:s3cret@db.internal:5432/prod\n"
  ).repeat(Math.ceil(n / 300));

function timing() {
  console.error("note: `timing` measures the QUADRATIC before-patterns and takes tens of");
  console.error("minutes. For after-only figures use `labels`, `bounds`, or read the rows");
  console.error("as they stream.\n");
  const rungs = [50, 100, 200, 400].map((k) => k * KB);
  console.log(`node ${process.version}\n`);
  console.log(
    "pattern              variant       50KB      100KB      200KB      400KB   growth(400/200)",
  );
  for (const name of Object.keys(AFTER)) {
    for (const [variant, table] of [
      ["before", BEFORE],
      ["after", AFTER],
    ]) {
      const r = rungs.map((n) => median3(table[name], SEEDS[name](n)));
      console.log(
        `${name.padEnd(20)} ${variant.padEnd(7)}${r.map(fmt).join("")}   x${(r[3] / r[2]).toFixed(2)}`,
      );
    }
  }
  console.log("\nLabel-widening seeds (were non-matching before 2026-07-25, so ~0 ms):");
  for (const [label, mk] of Object.entries(EXTRA_PK_SEEDS)) {
    for (const [variant, table] of [
      ["before", BEFORE],
      ["after", AFTER],
    ]) {
      const r = rungs.map((n) => median3(table.private_key_block, mk(n)));
      console.log(
        `${label.padEnd(32)} ${variant.padEnd(7)}${r.map(fmt).join("")}   x${(r[3] / r[2]).toFixed(2)}`,
      );
    }
  }

  console.log("\nDetectors added 2026-07-25 (no 'before' — they did not exist):");
  for (const [name, { re, seed }] of Object.entries(NEW_DETECTORS)) {
    const r = rungs.map((n) => median3(re, seed(n)));
    console.log(`${name.padEnd(28)}${r.map(fmt).join("")}   x${(r[3] / r[2]).toFixed(2)}`);
  }

  console.log("\nBenign 200 KB build log (no adversarial run) — all 7 patterns:");
  const benign = benignLog(200 * KB);
  for (const name of Object.keys(AFTER)) {
    console.log(
      `  ${name.padEnd(20)} before${fmt(median3(BEFORE[name], benign))}   after${fmt(median3(AFTER[name], benign))}`,
    );
  }
}

// ─── seeded differential fuzz ────────────────────────────────────────────────

// Fixed seed: the divergence counts quoted in the spec must be reproducible.
let state = 0x51f3a7d;
const rnd = () => {
  state = (state * 1103515245 + 12345) & 0x7fffffff;
  return state / 0x7fffffff;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const run = (chars, n) => {
  let s = "";
  for (let i = 0; i < n; i += 1) s += pick([...chars]);
  return s;
};
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
// lengths straddling every bound this change introduces
const LEN = () => pick([0, 1, 39, 40, 41, 63, 64, 65, 255, 256, 257, 2047, 2048, 2049, 300, 900]);
const WS = () => run(" \t\n", int(0, 3));
const NOISE = () => run("abZ09 \t\n:=\"'/@?#.-_%+", int(0, 25));
const B64 = "ABCXYZabcxyz0189+/=";

const GEN = {
  aws_secret_key: () =>
    `${NOISE()}aws_secret_access_key${WS()}=${WS()}${run("ABCXYZabcxyz0189+/", LEN())}${NOISE()}`,
  api_key_header: () =>
    `${NOISE()}${pick(["x-api-key", "X-API-KEY", "x-auth-token", "x-access-token"])}${WS()}${pick([":", "="])}${WS()}${pick(['"', "'", ""])}${run(`${B64}-_. `, LEN())}${pick(['"', "'", ""])}${NOISE()}`,
  basic_auth_header: () =>
    `${NOISE()}${pick(["authorization", "Authorization", "AUTHORIZATION"])}${WS()}${pick([":", "="])}${WS()}${pick(["basic", "Basic", "BASIC"])}${run(" \t", int(1, 3))}${run(B64, LEN())}${NOISE()}`,
  db_url: () =>
    `${NOISE()}${pick(["postgres", "postgresql", "mysql", "mongodb"])}://${run("abZ09.-_:", LEN())}:${run("abZ09.-_:@", LEN())}@${run("abZ09.-_/:", LEN())}${NOISE()}`,
  url_basic_auth: () =>
    `${NOISE()}${pick(["http", "https", "ftp", "redis", "svn+ssh", "s3", "x"])}://${run("abZ09.-_", LEN())}:${run("abZ09.-_:@/", LEN())}@${run("abZ09.-", int(1, 20))}${pick(["/", "?", "#", ":", ""])}${NOISE()}`,
  private_key_block: () => {
    // "" is PKCS#8 and "PGP " carries a ` BLOCK` suffix — both were unmatchable
    // before 2026-07-25, so they show up as GAINS (diverged, not lost).
    // Includes digit/dot/hyphen labels, or the grouped-label change gets no
    // differential coverage at all — the old class matched every label here.
    const label = pick([
      "",
      "RSA ",
      "EC ",
      "OPENSSH ",
      "PGP ",
      "ML-DSA-44 ",
      "ML-KEM-512 ",
      "SLH-DSA-SHAKE-256s ",
      "X9.42 DH ",
      "ED25519 ",
      "RSA-PSS ",
    ]);
    const suffix = label === "PGP " ? " BLOCK" : "";
    const body = run(`${B64}\n`, pick([1, 100, 3200, 32760, 32768, 32770, 40000]));
    return `${NOISE()}-----BEGIN ${label}PRIVATE KEY${suffix}-----\n${body}\n-----END ${label}PRIVATE KEY${suffix}-----${NOISE()}`;
  },
  email: () =>
    `${NOISE()}${run("abZ09._%+-", LEN())}@${run("abZ09.-", int(1, 300))}.${run("abZ", int(1, 4))}${NOISE()}`,
};

// The alternatives that were measured and REJECTED. Each row's divergence count
// is cited in the spec and in the source comments; this is where they come from.
const REJECTED = {
  "db_url user [^\\s/:]+ (colon-free, needs no bound)": {
    base: BEFORE.db_url,
    alt: /(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/:]+:[^\s@]+@\S+/g,
    gen: GEN.db_url,
    trials: 200_000,
  },
  "email + domain bound {1,255}": {
    base: BEFORE.email,
    alt: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g,
    gen: GEN.email,
    trials: 50_000,
  },
  "email left-boundary guard instead of a bound": {
    base: BEFORE.email,
    alt: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    gen: GEN.email,
    trials: 50_000,
  },
};

function differential(base, alt, gen, trials) {
  let matched = 0;
  let diverged = 0;
  let lost = 0;
  let gained = 0;
  let countChanged = 0;
  for (let i = 0; i < trials; i += 1) {
    const s = gen();
    const a = s.replace(new RegExp(base.source, base.flags), "<R>");
    const b = s.replace(new RegExp(alt.source, alt.flags), "<R>");
    const ca = (s.match(new RegExp(base.source, base.flags)) ?? []).length;
    const cb = (s.match(new RegExp(alt.source, alt.flags)) ?? []).length;
    if (a !== s) matched += 1;
    if (a !== b) diverged += 1;
    if (a !== s && b === s) lost += 1;
    if (a === s && b !== s) gained += 1;
    if (ca !== cb) countChanged += 1;
  }
  return { matched, diverged, lost, gained, countChanged, trials };
}

function fuzz() {
  console.log("SHIPPED patterns vs HEAD — divergences are expected only where a bound binds.");
  console.log("'lost'   = HEAD redacted something, shipped redacts NOTHING (a regression).");
  console.log("'gained' = HEAD redacted nothing, shipped redacts (new coverage).\n");
  console.log("pattern              trials   matched  diverged     lost   gained  countChanged");
  for (const name of Object.keys(AFTER)) {
    const r = differential(BEFORE[name], AFTER[name], GEN[name], 50_000);
    console.log(
      `${name.padEnd(20)}${String(r.trials).padStart(8)}${String(r.matched).padStart(10)}${String(r.diverged).padStart(10)}${String(r.lost).padStart(9)}${String(r.gained).padStart(9)}${String(r.countChanged).padStart(14)}`,
    );
  }
  console.log("\nREJECTED alternatives — why each was not shipped:");
  for (const [label, cfg] of Object.entries(REJECTED)) {
    const r = differential(cfg.base, cfg.alt, cfg.gen, cfg.trials);
    console.log(
      `  ${label}\n    trials=${r.trials} matched=${r.matched} diverged=${r.diverged} LOST=${r.lost} gained=${r.gained} countChanged=${r.countChanged}`,
    );
  }
  console.log("\nNamed total-loss shapes for the rejected alternatives:");
  const cases = [
    [
      "db_url colon-free user",
      "postgres://:-_Z:pw@host",
      BEFORE.db_url,
      REJECTED["db_url user [^\\s/:]+ (colon-free, needs no bound)"].alt,
    ],
    [
      "email domain bound",
      `u@${"b".repeat(300)}.com`,
      BEFORE.email,
      REJECTED["email + domain bound {1,255}"].alt,
    ],
    [
      "email boundary guard",
      "a@b.com.c@d.com",
      BEFORE.email,
      REJECTED["email left-boundary guard instead of a bound"].alt,
    ],
  ];
  for (const [label, input, base, alt] of cases) {
    const ca = (input.match(new RegExp(base.source, base.flags)) ?? []).length;
    const cb = (input.match(new RegExp(alt.source, alt.flags)) ?? []).length;
    console.log(
      `  ${label.padEnd(24)} ${JSON.stringify(input.slice(0, 40))}  HEAD=${ca} alt=${cb}`,
    );
  }
}

// ─── bound sweeps ────────────────────────────────────────────────────────────

function bounds() {
  const rungs = [100, 200, 400].map((k) => k * KB);
  // A JWE: five segments whose SECOND is a wrapped CEK, not `eyJ`, so the `jwt`
  // detector cannot rescue it. Any coverage check for these bounds must use an
  // opaque payload like this — a JWS fixture is redacted by `jwt` regardless
  // and proves nothing.
  const opaque = `${"A".repeat(342)}.${"B".repeat(16)}.${"C".repeat(2100)}.${"D".repeat(22)}`;

  console.log("db_url password bound (user fixed at {1,256})   covers: 2.5KB opaque / 8KB");
  for (const p of [256, 2048, 4096, 8192, 16384]) {
    const re = new RegExp(
      `(?:postgres|postgresql|mysql|mongodb):\\/\\/[^\\s/]{1,256}:[^\\s@]{1,${p}}@\\S+`,
      "g",
    );
    const r = rungs.map((n) => median3(re, SEEDS.db_url(n)));
    const cov = (pw) => new RegExp(re.source, re.flags).test(`postgres://u:${pw}@db.example.com/x`);
    console.log(
      `  {1,${String(p).padEnd(5)}}${r.map(fmt).join("")}  x${(r[2] / r[1]).toFixed(2)}   ${cov(opaque)} / ${cov("y".repeat(8000))}`,
    );
  }

  console.log("\nurl_basic_auth password bound                  covers: 2.5KB opaque / 8KB");
  for (const p of [2048, 4096, 8192, 16384]) {
    const re = new RegExp(
      `(?<=[a-z][a-z0-9+.-]*:\\/\\/)[^\\s\\/?#:]*:[^\\s?#]{1,${p}}?(?=@(?:[^\\s\\/?#@:]+(?:[\\/?#:]|$)|\\s|$))`,
      "gi",
    );
    const r = rungs.map((n) => median3(re, SEEDS.url_basic_auth(n)));
    const cov = (pw) => new RegExp(re.source, re.flags).test(`https://u:${pw}@api.example.com/v1`);
    console.log(
      `  {1,${String(p).padEnd(5)}}${r.map(fmt).join("")}  x${(r[2] / r[1]).toFixed(2)}   ${cov(opaque)} / ${cov("y".repeat(8000))}`,
    );
  }

  // The direction of this one REVERSES with input size. Below ~1-2 MB a larger
  // bound is slower than none (V8's counted lazy loop costs ~2x per step and the
  // bound prunes nothing); at the 4 MB capture cap the bound is what saves you.
  console.log("\nprivate_key_block body bound — note the ordering flips with size");
  const pkRungs = [200 * KB, 1024 * KB, 4096 * KB];
  console.log("  bound          200KB       1MB       4MB   max base64 (64-col wrapped)");
  const wrap64 = (s) => (s.match(/.{1,64}/g) ?? []).join("\n");
  for (const b of [null, 16384, 32768, 100000]) {
    const re =
      b === null
        ? BEFORE.private_key_block
        : new RegExp(
            // Shipped label/noun structure, so these numbers are comparable to
            // the ceiling figures quoted elsewhere. Only the body bound varies.
            `-----BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\\s\\S]{1,${b}}?-----END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----`,
            "g",
          );
    const r = pkRungs.map((n) => median3(re, SEEDS.private_key_block(n)));
    let cap = "unlimited";
    if (b !== null) {
      let lo = 1000;
      let hi = b;
      const fits = (n) =>
        new RegExp(re.source, re.flags).test(
          `-----BEGIN RSA PRIVATE KEY-----\n${wrap64("A".repeat(n))}\n-----END RSA PRIVATE KEY-----`,
        );
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fits(mid)) lo = mid;
        else hi = mid - 1;
      }
      cap = `${lo} (~${((lo * 3) / 4 / 1024).toFixed(1)} KB raw key)`;
    }
    console.log(`  ${String(b ?? "none").padEnd(8)}${r.map(fmt).join("")}   ${cap}`);
  }
}

// Produces the label-form comparison quoted in the spec and the §5a footnote.
// Without this the x7.81 / 1,169 ms / 552 ms / 2,187 ms figures are not
// reproducible from any committed harness mode.
function labels() {
  const seed = (n) => "-----BEGIN A PRIVATE KEY-----".repeat(Math.ceil(n / 29));
  const forms = {
    "[A-Z ]* (previous)": "[A-Z ]*",
    "[A-Za-z0-9. -]* unbounded": "[A-Za-z0-9. -]*",
    "[A-Za-z0-9. -]{0,64}": "[A-Za-z0-9. -]{0,64}",
    "grouped (shipped)": "(?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*",
  };
  const mk = (c) =>
    new RegExp(
      `-----BEGIN ${c}(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\\s\\S]{1,32768}?-----END ${c}(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----`,
      "g",
    );
  // OpenSSL 3.6.2's own PEM table: `strings libcrypto | grep 'PRIVATE KEY$'`.
  const LABELS = [
    "ANY",
    "DH",
    "DSA",
    "EC",
    "ENCRYPTED",
    "RSA",
    "",
    "ED25519",
    "ED448",
    "X25519",
    "X448",
    "SM2",
    "RSA-PSS",
    "X9.42 DH",
    "ML-DSA-44",
    "ML-DSA-65",
    "ML-DSA-87",
    "ML-KEM-512",
    "ML-KEM-768",
    "ML-KEM-1024",
    "SLH-DSA-SHA2-128f",
    "SLH-DSA-SHA2-128s",
    "SLH-DSA-SHA2-192f",
    "SLH-DSA-SHA2-192s",
    "SLH-DSA-SHA2-256f",
    "SLH-DSA-SHA2-256s",
    "SLH-DSA-SHAKE-128f",
    "SLH-DSA-SHAKE-128s",
    "SLH-DSA-SHAKE-192f",
    "SLH-DSA-SHAKE-192s",
    "SLH-DSA-SHAKE-256f",
    "SLH-DSA-SHAKE-256s",
  ];
  // Rungs are small on purpose: the unbounded char-class form is quadratic, so
  // at 200 KB this mode would not finish. 16/32/64 KB is where all four forms
  // are measurable and the divergence is already unmistakable.
  // NOTE the x3.0 growth on the linear forms: below the 32768 body bound the
  // scan is input-limited, so these rungs sit in the PRE-bound regime. At
  // 100/200/400 KB, where the bound binds, the same forms measure x1.9-2.1 —
  // see `timing`. Read this table for cost-vs-coverage, not for linearity.
  console.log("label form                       16KB      32KB      64KB   growth   covers");
  for (const [name, cls] of Object.entries(forms)) {
    const re = mk(cls);
    const r = [16, 32, 64].map((k) => median3(re, seed(k * KB)));
    const covered = LABELS.filter((l) =>
      mk(cls).test(
        `-----BEGIN ${l ? `${l} ` : ""}PRIVATE KEY-----\nAAAA\n-----END ${l ? `${l} ` : ""}PRIVATE KEY-----`,
      ),
    ).length;
    console.log(
      `${name.padEnd(28)}${r.map(fmt).join("")}   x${(r[2] / r[1]).toFixed(2)}   ${covered}/${LABELS.length}`,
    );
  }
}

const isCli = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

// Runs for EVERY mode. The guard was previously reachable only from `timing`,
// which is also the mode this file tells reviewers to avoid.
if (isCli) assertSeedsMatch();

// Spec 2026-07-26-carrier-residual-gaps-design §4: the `\s{0,8}` gaps multiply
// the lookbehind's internal alternatives, and the guard `(?=[^;\s])` prunes
// almost nothing because nearly every character is in `[^;\s]`. So the
// lookbehind runs at nearly every position with a larger constant. Growth per
// doubling is the load-bearing figure; the constants move with the box.
const CARRIER_BEFORE = {
  gitlab_token: /gl(?:pat|rt|ptt|dt|cbt|oas)-[A-Za-z0-9_-]{20,}/g,
  connection_string_secret:
    /(?=[^;\s])(?<=(?:^|;)(?:password|accountkey|sharedaccesskey|sharedaccesssignature|userpassword)=)[^;\s]{8,}/gi,
};

const CARRIER_SEEDS = {
  // Guard passes at every position and the lookbehind must fail: the shape the
  // `\s{0,8}` gaps make more expensive.
  "conn: bare anchor run": (n) => "password=1234567;".repeat(Math.ceil(n / 17)),
  // Maximal gap work — 8 spaces on both sides of `=`, value under the floor,
  // so every anchor is paid for and none matches.
  "conn: maximal ws gaps": (n) =>
    `;password${" ".repeat(8)}=${" ".repeat(8)}1234567`.repeat(Math.ceil(n / 34)),
  // An unterminated quote: the bounded run stops at 8192 instead of scanning to
  // the next quote in the file.
  "conn: unterminated quote": (n) => `;password="${"a".repeat(200)}`.repeat(Math.ceil(n / 212)),
  "gitlab: anchor run": (n) => "glagent-".repeat(Math.ceil(n / 8)),
  "slack: anchor run": (n) => "https://hooks.slack.com/services/".repeat(Math.ceil(n / 33)),
};

// Load guard. Twice now a measurement on this repo was taken on a box carrying
// orphaned test workers — once at 5x inflation, once at load 124 on 10 cores,
// where every growth ratio came out between x0.97 and x13.70 on patterns that
// are provably linear. min-of-N does not save you: at that load there is no
// quiet slice to find. Refuse rather than print a number nobody can trust.
function assertQuietBox() {
  const load = os.loadavg()[0];
  const cores = os.cpus().length;
  if (load > cores * 0.75) {
    console.error(
      `LOADED BOX: 1-min load ${load.toFixed(1)} on ${cores} cores. Growth ratios here are noise.
Check for orphaned workers (ps -Ao pid,ppid,%cpu,etime,command | awk '$2==1') and
re-run once load settles below ${(cores * 0.75).toFixed(0)}.`,
    );
    process.exitCode = 1;
    return false;
  }
  return true;
}

function carriers() {
  if (!assertQuietBox()) return;
  // 512 KB and up, not the 100/200/400 the other modes use: these three rows
  // land at 0.2-3 ms there, where the timer floor dominates and the ratios are
  // meaningless. At 512 KB-4 MB the signal clears the floor.
  const rungs = [512, 1024, 2048, 4096].map((k) => k * KB);
  console.log(`node ${process.version}\n`);
  console.log(
    "seed                       detector                 512KB      1MB        2MB        4MB   growth(4M/2M)  matches@4MB",
  );
  const rows = [
    ["conn: bare anchor run", "connection_string_secret"],
    ["conn: maximal ws gaps", "connection_string_secret"],
    ["conn: unterminated quote", "connection_string_secret"],
    ["gitlab: anchor run", "gitlab_token"],
    ["slack: anchor run", "slack_webhook_url"],
  ];
  for (const [seedName, det] of rows) {
    const mk = CARRIER_SEEDS[seedName];
    const re = NEW_DETECTORS[det].re;
    const r = rungs.map((n) => median3(re, mk(n)));
    const hits = (mk(rungs[3]).match(new RegExp(re.source, re.flags)) ?? []).length;
    console.log(
      `${seedName.padEnd(26)} ${det.padEnd(24)}${r.map(fmt).join("")}   x${(r[3] / r[2]).toFixed(2)}` +
        `        ${hits}`,
    );
    const before = CARRIER_BEFORE[det];
    if (before) {
      const b = rungs.map((n) => median3(before, mk(n)));
      console.log(
        `${"  (before this change)".padEnd(26)} ${"".padEnd(24)}${b.map(fmt).join("")}   x${(b[3] / b[2]).toFixed(2)}`,
      );
    }
  }
  console.log("\nBenign 200 KB build log — constant, not growth:");
  const benign = benignLog(200 * KB);
  for (const det of ["connection_string_secret", "gitlab_token", "slack_webhook_url"]) {
    const after = median3(NEW_DETECTORS[det].re, benign);
    const before = CARRIER_BEFORE[det] ? median3(CARRIER_BEFORE[det], benign) : null;
    console.log(
      `  ${det.padEnd(26)} after${fmt(after)}${before === null ? "" : `   before${fmt(before)}`}`,
    );
  }
}

// Entry-point guard. Without it, `import` of this module runs `timing` — the
// mode the header tells reviewers to avoid because it takes tens of minutes.
if (isCli) {
  if (mode === "labels") labels();
  else if (mode === "timing") timing();
  else if (mode === "fuzz") fuzz();
  else if (mode === "bounds") bounds();
  else if (mode === "carriers") carriers();
  else {
    console.error(`unknown mode ${mode}; expected timing | fuzz | bounds | labels | carriers`);
    process.exit(1);
  }
}
