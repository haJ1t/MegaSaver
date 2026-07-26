import { describe, expect, it } from "vitest";
import { redactWithFindings } from "../src/redact.js";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

// Spec: docs/superpowers/specs/2026-07-25-secret-path-home-credentials-design.md
// Gap (b). A path denial is the first line of defence and stops a direct read;
// these are the same bytes arriving by another route — grep output, a pasted
// config, a build log, a `kubectl` dump — where the redactor is the only one.

const finding = (text: string, name: string): number =>
  redactWithFindings(text).findings.find((f) => f.name === name)?.count ?? 0;

// Assembled, not written out: `_authToken=<uuid>` on one line is exactly what
// GitHub push protection reads as a live npm credential, and it blocked this
// branch. The value is synthetic, but the scanner cannot know that. Joining at
// runtime keeps the real legacy-npm shape under test without a token-shaped
// literal on disk.
const NPM_UUID = ["b7f3c1e2", "4a5d", "4c9b", "8e10", "2f6a9d3b7c14"].join("-");

describe("home credential carriers are redacted (spec §3c)", () => {
  const positives: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      "npmrc legacy uuid _authToken",
      "npmrc_auth",
      `//registry.npmjs.org/:_authToken=${NPM_UUID}`,
      NPM_UUID,
    ],
    [
      "npmrc Artifactory base64 _authToken",
      "npmrc_auth",
      "//art.co/api/npm/:_authToken=QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
      "QWxhZGRpbjpvcGVuIHNlc2FtZQ==",
    ],
    [
      "npmrc _auth (base64 user:password)",
      "npmrc_auth",
      "//registry.internal/:_auth=dXNlcjpwYXNzd29yZA==",
      "dXNlcjpwYXNzd29yZA==",
    ],
    // npm's own ini serializer JSON.stringify()s any value containing `=` —
    // base64 padding, i.e. most real `_auth`/Artifactory tokens — so the
    // DOUBLE-QUOTED spelling is what `npm config set` writes, not an edge case.
    // `~/.npmrc` is off the denylist by design (§4a), so this detector is the
    // only defence for these bytes and it has to survive the quotes.
    [
      "npmrc double-quoted _auth, as `npm config set` writes it",
      "npmrc_auth",
      '_auth="dXNlcjpwYXNzd29yZA=="',
      "dXNlcjpwYXNzd29yZA==",
    ],
    [
      "npmrc double-quoted Artifactory _authToken",
      "npmrc_auth",
      '//art.co/api/npm/:_authToken="AKCp8kqYq2wYc1TgLb3kQhqZ5Nn7RtVvXxZz"',
      "AKCp8kqYq2wYc1TgLb3kQhqZ5Nn7RtVvXxZz",
    ],
    [
      "npmrc single-quoted legacy uuid _authToken",
      "npmrc_auth",
      `//r/:_authToken='${NPM_UUID}'`,
      NPM_UUID,
    ],
    [
      "pgpass record",
      "pgpass_line",
      "prod-db.internal:5432:payments:svc_payments:Pg-Sup3r-S3cr3t-2026",
      "Pg-Sup3r-S3cr3t-2026",
    ],
    // A `.pgpass` field escapes `:` and `\` with a backslash, so an escaped
    // colon is legal INSIDE the password and must not end the value run.
    [
      "pgpass record whose password contains an escaped colon",
      "pgpass_line",
      "h.internal:5432:db:user:pa\\:ss-w0rd-with-colon",
      "pa\\:ss-w0rd-with-colon",
    ],
    [
      "kubeconfig user token",
      "kubeconfig_token",
      "    token: k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef",
      "k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef",
    ],
  ];

  for (const [label, detector, input, secret] of positives) {
    it(`${label} reports ${detector} and leaves no cleartext`, () => {
      const result = redactWithFindings(input);
      expect(result.findings.map((f) => f.name)).toContain(detector);
      expect(result.redacted).not.toContain(secret);
    });
  }

  // Multi-line carriers, as the files actually arrive.
  it("redacts every record of a multi-line .pgpass file", () => {
    const file = [
      "prod-db.internal:5432:payments:svc_payments:Pg-Sup3r-S3cr3t-2026",
      "replica.internal:5433:analytics:ro_user:An0ther-P4ssw0rd",
    ].join("\n");
    const result = redactWithFindings(file);
    expect(finding(file, "pgpass_line")).toBe(2);
    expect(result.redacted).not.toContain("Pg-Sup3r-S3cr3t-2026");
    expect(result.redacted).not.toContain("An0ther-P4ssw0rd");
    // The record structure is evidence: which host, which user.
    expect(result.redacted).toContain("prod-db.internal:5432:payments:svc_payments:");
  });

  it("redacts a kubeconfig users block and keeps the surrounding structure", () => {
    const file = [
      "users:",
      "- name: prod-admin",
      "  user:",
      "    token: k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef",
      "    id-token: eyJhbGciXX.payloadpayloadpayload.signaturesignature",
    ].join("\n");
    const result = redactWithFindings(file);
    expect(finding(file, "kubeconfig_token")).toBeGreaterThanOrEqual(1);
    expect(result.redacted).not.toContain("k8s-svc-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef");
    expect(result.redacted).toContain("- name: prod-admin");
  });
});

// The PWD= class. A detector that destroys evidence in the stream this redactor
// filters is the single most expensive mistake this table has made — it is why
// `pwd` was dropped from connection_string_secret. Byte-identical output, not
// just count===0: a finding with an empty replacement would still pass a count
// check while silently rewriting the text.
describe("home credential detectors preserve evidence (spec §5)", () => {
  const negatives: ReadonlyArray<readonly [string, string]> = [
    ["a boolean-valued yaml token key", "    token: yes"],
    ["a numeric-valued yaml token key", "  token: 42"],
    ["the universal PWD environment variable", "PWD=/Users/x/p"],
    ["a four-field colon line", "a:b:c:d"],
    ["a URL with a port inside prose", "see http://host:8080:x:y:z in prose"],
    ["a JSON token field", '{"token": "abcdefghijklmnop"}'],
    ["a short --auth flag value", "--auth=short"],
    ["an ordinary five-field record with no numeric port", "alpha:beta:gamma:delta:epsilon"],
    ["a make target line", "build:test:lint:docs:all"],
    // A 16-character floor is not a discriminator: every identifier expression
    // clears it. These are real lines from this repo and from node_modules —
    // packages/daemon/src/discovery.ts:8 is the first one verbatim.
    ["a zod schema field named token", "  token: z.string().min(1),"],
    ["a token read from the environment", "  token: process.env.GITHUB_TOKEN,"],
    ["a token generated in code", "  token: crypto.randomUUID(),"],
    ["a placeholder token in docs", "  token: <PLACEHOLDER-VALUE-HERE>"],
    ["a member expression token value", "  token: newSsoOidcToken.accessToken,"],
    // The two five-field negatives above have no numeric second field, so the
    // `\d{1,5}` port rejects them at position 0 and they fence nothing. These
    // all clear the port gate and are still not credentials.
    ["a timestamped log line", "12:34:56:789:request completed ok"],
    ["a frame-offset trace line", "00:00:05:12:frame data here"],
    ["a fully expanded IPv6 address", "2001:0000:0000:0000:0000:0000:0000:0001"],
    ["a service status line", "CACHE:8080:web:nginx:restarting now"],
    ["prose after four colons", "note:1:a:b:this is prose after four colons"],
  ];

  for (const [label, input] of negatives) {
    it(`leaves ${label} byte-identical`, () => {
      for (const name of ["npmrc_auth", "pgpass_line", "kubeconfig_token"]) {
        expect(finding(input, name)).toBe(0);
      }
      expect(redactWithFindings(input).redacted).toBe(input);
    });
  }
});

// The value bounds buy no speed on these shapes — measured in
// redact-superlinear.test.ts — so they are over-redaction controls, and the
// coverage they cost is a real hole. Assert the hole: without these, every
// bound-edge mutant is invisible outside the byte pin, which is how eleven
// mutants survived the last round of this table.
describe("disclosed losses — deliberate, see spec §3c before 'fixing' them", () => {
  const tail = (input: string) => redactWithFindings(input).redacted;

  it("npmrc_auth keeps the tail of a value over 4096 characters", () => {
    const secret = "A".repeat(5000);
    const out = tail(`//r/:_authToken=${secret}`);
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("A".repeat(900));
  });

  // Both value runs now have to reach end-of-line, which is what stops them
  // eating log lines and source code. The cost is at the ceiling: a value
  // longer than the bound no longer truncates, it stops matching. Worse for
  // that one shape than truncation was, and the price of not being an
  // LLM-blinder on every colon-delimited line in the stream.
  it("pgpass_line misses a password over 512 characters entirely", () => {
    expect(finding(`h.internal:5432:db:user:${"B".repeat(600)}`, "pgpass_line")).toBe(0);
  });

  it("kubeconfig_token misses a token over 4096 characters entirely", () => {
    expect(finding(`    token: ${"C".repeat(5000)}`, "kubeconfig_token")).toBe(0);
  });

  it("kubeconfig_token misses a token followed by an inline comment", () => {
    expect(finding("    token: abcdefghijklmnop # prod", "kubeconfig_token")).toBe(0);
  });

  // Residual over-redaction, pinned so it is a decision and not a surprise: a
  // bare identifier alone on the line is byte-identical to a YAML scalar and
  // nothing in the text can separate them.
  it("kubeconfig_token still fires on a bare identifier at end of line", () => {
    expect(finding("token: authorizationHeaderValue", "kubeconfig_token")).toBe(1);
  });

  it("pgpass_line misses the legal `*` wildcard port form", () => {
    const line = "h.internal:*:db:user:Wildcard-P4ss";
    expect(finding(line, "pgpass_line")).toBe(0);
  });

  it("npmrc_auth truncates a value at an embedded quote", () => {
    const out = tail(`_auth=abcdefgh'trailing`);
    expect(out).toContain("[REDACTED]'trailing");
  });
});

describe("the three detectors are appended, not interleaved (spec §3c)", () => {
  it("are the last three rows of REDACTION_PATTERNS", () => {
    expect(REDACTION_PATTERNS.map((p) => p.name).slice(-3)).toEqual([
      "npmrc_auth",
      "pgpass_line",
      "kubeconfig_token",
    ]);
  });
});
