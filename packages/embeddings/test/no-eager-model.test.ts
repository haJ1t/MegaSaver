import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression guard: @huggingface/transformers (and its native onnxruntime-node)
// downloads ~50MB on first model use and is platform-specific. It MUST NOT load
// just because @megasaver/embeddings was imported — only an actual embed() call
// may pull it in (lazily, via cached dynamic import).
//
// We assert on the built bundle, not process.moduleLoadList: moduleLoadList
// records only native + CJS-require loads, NOT ESM-graph loads. transformers is
// ESM (type:module, resolves to transformers.node.mjs), so a real eager
// top-level `import ... from "@huggingface/transformers"` loads via the ESM
// loader and never enters moduleLoadList — a moduleLoadList==0 check is vacuous
// for it. onnxruntime is only loaded transitively BY transformers at model-run
// time, so it never appears in this package's own dist; the only thing keeping
// it out is transformers itself being dynamic-only, so that is what we assert.
describe("no eager model load", () => {
  it("dist/index.js reaches @huggingface/transformers only via dynamic import", () => {
    const dist = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
    // reachable lazily (dynamic import survives to the bundle):
    expect(dist).toMatch(/import\(\s*["']@huggingface\/transformers["']\s*\)/);
    // and NEVER statically imported (eager at module-eval time):
    expect(dist).not.toMatch(/from\s*["']@huggingface\/transformers["']/);
    expect(dist).not.toMatch(/^\s*import\s*["']@huggingface\/transformers["']/m);
  });
});
