import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

const SECRETS: ReadonlyArray<readonly [string, string]> = [
  ["github_token", `token=ghp_${"a".repeat(36)}`],
  ["openai_key", `key=sk-${"A".repeat(24)}`],
  ["anthropic_key", `key=sk-ant-${"A".repeat(24)}`],
  ["aws_access_key", "id=AKIAIOSFODNN7EXAMPLE"],
  ["aws_secret_key", `aws_secret_access_key = ${"b".repeat(40)}`],
  ["bearer_token", `Authorization: Bearer ${"c".repeat(24)}`],
  ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4"],
  [
    "private_key_block",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END RSA PRIVATE KEY-----",
  ],
  ["env_value", `API_TOKEN="super-secret-value"`],
  ["db_url", "postgres://user:password@db.example.com:5432/app"],
];

describe("redact — per-pattern positives (spec §5a)", () => {
  for (const [name, sample] of SECRETS) {
    it(`redacts ${name} and increments count`, () => {
      const result = redact(sample);
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(result.redacted).toContain("REDACTED");
    });
  }

  it("anthropic_key is redacted before openai_key (prefix ordering)", () => {
    const result = redact(`key=sk-ant-${"A".repeat(24)}`);
    expect(result.redacted).toContain("sk-ant-[REDACTED]");
  });
});

describe("redact — negatives (spec §5)", () => {
  const negatives = [
    "Please show the bearer of this note to the front desk.",
    "The key to success is consistency.",
    "We discussed the environment variables during the meeting.",
  ];

  for (const text of negatives) {
    it(`leaves secret-shaped prose untouched: ${text.slice(0, 24)}...`, () => {
      const result = redact(text);
      expect(result).toEqual({ redacted: text, count: 0 });
    });
  }

  it("returns count 0 and original text for secret-free input", () => {
    const text = "hello world";
    expect(redact(text)).toEqual({ redacted: text, count: 0 });
  });

  it("returns count 0 for the empty string", () => {
    expect(redact("")).toEqual({ redacted: "", count: 0 });
  });
});
