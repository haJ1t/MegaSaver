import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { countTokens, estimateTokens } from "../src/tokens.js";

describe("countTokens (real BPE, reporting boundary)", () => {
  it("counts cl100k_base tokens exactly on known ASCII input", async () => {
    // cl100k_base: "hello" = 15339, " world" = 1917.
    await expect(countTokens("hello world")).resolves.toBe(2);
  });

  it("is not the bytes/4 heuristic", async () => {
    // 44 bytes → heuristic says 11; cl100k_base says 2.
    const text = "hello world hello world hello world hello world";
    const real = await countTokens(text);
    expect(real).not.toBeNull();
    expect(real).not.toBe(estimateTokens(text));
  });

  it("memoizes the encoding across calls", async () => {
    const [a, b] = await Promise.all([countTokens("foo"), countTokens("foo")]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("counts Turkish text without throwing and returns a sane count", async () => {
    const real = await countTokens("Sıkıştırma motoru bağlamı koruyarak token tasarrufu sağlar.");
    expect(real).not.toBeNull();
    expect(real).toBeGreaterThan(0);
    expect(real).toBeLessThan(100);
  });
});

// Same guard shape as no-eager-typescript: the BPE ranks are multi-MB and must
// load only when countTokens is actually awaited, never on package import.
describe("no eager js-tiktoken load", () => {
  it("importing @megasaver/output-filter does not load js-tiktoken", () => {
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(()=>{console.log(process.moduleLoadList.filter(m=>m.includes("node_modules/js-tiktoken")).length)})`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe("0");
  });
});
