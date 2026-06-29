import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Regression guard: @huggingface/transformers (and its native onnxruntime-node)
// downloads ~50MB on first model use and is platform-specific. It MUST NOT load
// just because @megasaver/embeddings was imported — only an actual embed() call
// may pull it in (lazily, via cached dynamic import). A child process is used so
// moduleLoadList reflects a clean import graph, not vitest's own.
describe("no eager model load", () => {
  it("importing @megasaver/embeddings loads zero transformers/onnxruntime modules", () => {
    // file:// URL (not a raw path) so import() works on Windows too —
    // an absolute path like "D:\\..." is rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(()=>{console.log(process.moduleLoadList.filter(m=>/node_modules[\\\\/](@huggingface[\\\\/]transformers|onnxruntime)/.test(m)).length)})`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe("0");
  });
});
