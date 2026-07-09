// packages/policy/test/redact-pii.test.ts
import { describe, expect, it } from "vitest";
import { redact, redactForLedger, redactWithFindings } from "../src/redact.js";

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

  it("redacts a valid lowercase IBAN (case-insensitive gate)", () => {
    // Regression: a case-sensitive gate skipped lowercase IBANs entirely, so a
    // valid one leaked unredacted (the validator upper-cases before checking).
    const r = redactWithFindings("iban gb82west12345698765432 done");
    expect(r.redacted).toContain("[REDACTED:iban]");
    expect(r.redacted).not.toContain("gb82west12345698765432");
    expect(r.findings).toContainEqual({ name: "iban", count: 1 });
  });
});

describe("redactForLedger — value-free ledger label (scrubs emails too)", () => {
  it("scrubs an email that redact() only observes", () => {
    // F-FW-1: a command line / path used as a ledger sourcePath must never
    // carry a raw value — including emails, which the output path only counts.
    const out = redactForLedger("git log --author=jane@corp.com");
    expect(out).not.toContain("jane@corp.com");
    expect(out).toContain("[REDACTED:email]");
  });

  it("still scrubs secrets and PII", () => {
    const out = redactForLedger("card 4111111111111111");
    expect(out).not.toContain("4111111111111111");
    expect(out).toContain("[REDACTED:credit_card]");
  });

  it("leaves clean text untouched", () => {
    expect(redactForLedger("cat notes.md")).toBe("cat notes.md");
  });
});
