import { describe, expect, it } from "vitest";
import { parseSABGrammarV0 } from "../src/sab-grammar.js";

describe("sab-grammar (Scaffold Check)", () => {
  it("parses SAB grammar v0 scaffold and marks parityValidated as false (unvalidated until eval harness runs)", () => {
    const rule = parseSABGrammarV0("function_signature", "typescript", "cl100k_base");
    expect(rule.symbolName).toBe("function_signature");
    expect(rule.language).toBe("typescript");
    expect(rule.parityValidated).toBe(false);
  });
});
