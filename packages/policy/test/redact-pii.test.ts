// packages/policy/test/redact-pii.test.ts
import { describe, expect, it } from "vitest";
import { redact, redactWithFindings } from "../src/redact.js";

describe("redactWithFindings — PII patterns (validate-gated)", () => {
  it("redacts a Luhn-valid card, including separator forms", () => {
    const r = redactWithFindings(
      "card 4111111111111111 and 4111 1111 1111 1111 and 4111-1111-1111-1111",
    );
    expect(r.redacted).not.toContain("4111111111111111");
    expect(r.redacted).toContain("[REDACTED:credit_card]");
    expect(r.findings).toContainEqual({ name: "credit_card", count: 3 });
  });

  it("leaves a checksum-broken 16-digit run alone", () => {
    const r = redactWithFindings("not a card: 4111111111111112");
    expect(r.redacted).toContain("4111111111111112");
    expect(r.findings.some((f) => f.name === "credit_card")).toBe(false);
  });

  it("redacts a valid IBAN and rejects a broken one", () => {
    const r = redactWithFindings("pay GB82WEST12345698765432 not GB82WEST12345698765431");
    expect(r.redacted).toContain("[REDACTED:iban]");
    expect(r.redacted).toContain("GB82WEST12345698765431");
    expect(r.findings).toContainEqual({ name: "iban", count: 1 });
  });

  it("redacts a valid TCKN and rejects a broken one", () => {
    const r = redactWithFindings("tckn 10000000146 vs 10000000147");
    expect(r.redacted).toContain("[REDACTED:tr_national_id]");
    expect(r.redacted).toContain("10000000147");
    expect(r.findings).toContainEqual({ name: "tr_national_id", count: 1 });
  });

  it("observes emails without redacting them", () => {
    const r = redactWithFindings("author a@example.com reviewer b@test.org");
    expect(r.redacted).toContain("a@example.com");
    expect(r.redacted).toContain("b@test.org");
    expect(r.observed).toEqual([{ name: "email", count: 2 }]);
  });

  it("keeps the aggregate count in sync and reports secrets in findings too", () => {
    const r = redactWithFindings(
      "token ghp_0123456789abcdef0123456789abcdef0123 card 4111111111111111",
    );
    expect(r.count).toBe(2);
    expect(r.findings.map((f) => f.name).sort()).toEqual(["credit_card", "github_token"]);
  });

  it("returns empty findings/observed on clean text", () => {
    const r = redactWithFindings("nothing sensitive here");
    expect(r).toEqual({ redacted: "nothing sensitive here", count: 0, findings: [], observed: [] });
  });
});

describe("redact — 2-field public contract preserved (non-breaking)", () => {
  it("still returns exactly {redacted, count} — no findings/observed keys", () => {
    const r = redact("nothing sensitive here");
    expect(r).toEqual({ redacted: "nothing sensitive here", count: 0 });
    expect(Object.keys(r).sort()).toEqual(["count", "redacted"]);
  });

  it("also catches the new PII patterns (behavior change, not shape change)", () => {
    const r = redact("card 4111111111111111");
    expect(r.redacted).toContain("[REDACTED:credit_card]");
    expect(r.count).toBe(1);
  });
});
