import { describe, expect, it } from "vitest";
import { z } from "zod";
import { redact } from "../src/redact.js";

// Unstructured / contextual secrets: tokens with no recognised prefix that are
// identifiable only by their CONTEXT — a secret-named query param, a credential
// in URL userinfo, a secret CLI flag value, or an api-key/auth header. These
// previously passed through verbatim (count 0) and reached disk via every saver
// sink (record-output / run-command / run / read) and the evidence sourceRef.

const QTOKEN = "deadbeefcafe0123456789abcdef0123"; // 32 hex, no recognised prefix
const PASS = "s3cretPASSWORD123";
const B64 = "dXNlcjpwYXNzd29yZA==";

describe("redact — unstructured/contextual secrets (positives)", () => {
  const positives: ReadonlyArray<readonly [string, string, string]> = [
    ["url query token", `https://api.example.com/data?token=${QTOKEN}`, QTOKEN],
    ["url query api_key", `https://api.example.com/data?api_key=${QTOKEN}&page=2`, QTOKEN],
    ["url query password", `https://api.example.com/x?password=${PASS}`, PASS],
    ["url basic auth", `https://admin:${PASS}@internal.example.com/path`, PASS],
    ["cli --token quoted space", `curl https://x --token "${QTOKEN}"`, QTOKEN],
    ["cli --password=", `deploy --password=${PASS}`, PASS],
    ["x-api-key header", `curl -H "x-api-key: ${QTOKEN}" https://x`, QTOKEN],
    ["authorization basic", `Authorization: Basic ${B64}`, B64],
  ];

  for (const [name, input, secret] of positives) {
    it(`redacts ${name}`, () => {
      const { redacted, count } = redact(input);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain("[REDACTED]");
    });
  }

  it("keeps the readable structure: host + param name survive, only the value is a marker", () => {
    const { redacted } = redact(`https://api.example.com/data?token=${QTOKEN}`);
    expect(redacted).toBe("https://api.example.com/data?token=[REDACTED]");
  });

  it("basic-auth redaction keeps scheme + host", () => {
    const { redacted } = redact(`https://admin:${PASS}@internal.example.com/path`);
    expect(redacted).toBe("https://[REDACTED]@internal.example.com/path");
  });
});

describe("redact — redacted URLs stay schema-valid (z.string().url())", () => {
  const url = z.string().url();
  it("redacted query-secret URL still parses as a URL", () => {
    const { redacted } = redact(`https://api.example.com/data?token=${QTOKEN}&page=2`);
    expect(() => url.parse(redacted)).not.toThrow();
  });
  it("redacted basic-auth URL still parses as a URL", () => {
    const { redacted } = redact(`https://admin:${PASS}@internal.example.com/path`);
    expect(() => url.parse(redacted)).not.toThrow();
  });
});

describe("redact — unstructured negatives (no false positives)", () => {
  const negatives = [
    "https://example.com/search?q=hello&page=2&sort=name",
    "https://user@github.com/org/repo.git",
    "https://api.example.com:8443/v1/data",
    "npm run build --workspace=app",
    "git log --oneline --graph",
    "ls --color=auto /usr/local/bin/python3.11",
    "/Users/dev/project/src/index.ts",
    "Please show the bearer of this note to the front desk.",
  ];
  for (const text of negatives) {
    it(`leaves benign input untouched: ${text.slice(0, 28)}...`, () => {
      expect(redact(text)).toEqual({ redacted: text, count: 0 });
    });
  }
});

// Regression cases from the adversarial review (PR block): leaks the patterns
// must close, and over-redaction they must NOT cause.
describe("redact — review hardening positives (leaks that must close)", () => {
  const FRAG_TOKEN = "ya29SECRETtokenVALUE123456";
  const SLASH_PW = "Ab1/Cd2/Ef3";
  const EMPTY_USER_PW = "supersecretpw0";

  const leaks: ReadonlyArray<readonly [string, string, string]> = [
    // OAuth/SSO implicit-flow callback delivers the token in the URL FRAGMENT.
    [
      "oauth fragment token",
      `https://app.example.com/callback#access_token=${FRAG_TOKEN}&token_type=bearer`,
      FRAG_TOKEN,
    ],
    // userinfo password containing '/' (must match baseline db_url strength).
    ["slashed-password userinfo", `https://svc:${SLASH_PW}@host.internal/v1`, SLASH_PW],
    // password-only userinfo (empty username) — redis/token-as-password shape.
    ["empty-username userinfo", `redis://:${EMPTY_USER_PW}@cache.prod:6379/0`, EMPTY_USER_PW],
  ];
  for (const [name, input, secret] of leaks) {
    it(`redacts ${name}`, () => {
      const { redacted, count } = redact(input);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain("[REDACTED]");
    });
  }

  it("fragment + query secrets both redacted, URL stays valid", () => {
    const { redacted } = redact(`https://app.example.com/callback#access_token=${FRAG_TOKEN}`);
    expect(redacted).toBe("https://app.example.com/callback#access_token=[REDACTED]");
  });
});

describe("redact — review hardening negatives (over-redaction that must NOT happen)", () => {
  // cli_secret_flag previously ate the next whitespace-delimited token: prose,
  // usage hints, the following flag, and shell operators (&&, |, >). The space
  // form must only redact a QUOTED value; unquoted prose stays intact.
  const negatives = [
    "error: --password requires an argument",
    "Usage: deploy --token <TOKEN> --region <REGION>",
    "$ mytool --token && echo done",
    "run --token | grep x",
    "write --token > out.txt",
    "The --token option accepts a value",
    "Pass --secret to enable debug mode",
  ];
  for (const text of negatives) {
    it(`does not over-redact: ${text.slice(0, 30)}...`, () => {
      expect(redact(text)).toEqual({ redacted: text, count: 0 });
    });
  }
});

describe("redact — cli secret flag still catches real values", () => {
  it("redacts the = form (unquoted)", () => {
    const { redacted, count } = redact("deploy --token=deadbeefcafe0123 --region us");
    expect(count).toBeGreaterThanOrEqual(1);
    expect(redacted).toBe("deploy --token=[REDACTED] --region us");
  });
  it("redacts the space form when the value is quoted", () => {
    const { redacted, count } = redact(`deploy --password "hunter2 secret" --region us`);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain("[REDACTED]");
  });
});

describe("redact — idempotence on unstructured secrets", () => {
  for (const input of [
    `https://api.example.com/data?token=${QTOKEN}`,
    `https://admin:${PASS}@host.com/p`,
    `deploy --password=${PASS}`,
  ]) {
    it(`redact is idempotent: ${input.slice(0, 32)}...`, () => {
      const once = redact(input).redacted;
      expect(redact(once).redacted).toBe(once);
    });
  }
});
