import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Regression guard: @megasaver/indexer statically imports the multi-MB
// `typescript` compiler. output-filter is the core every agent hook / daemon /
// CLI start transitively imports, so the compiler must NOT load just because
// output-filter was imported — only an actual semantic chunk of a source file
// may pull it in (lazily). A child process is used so moduleLoadList reflects a
// clean import graph, not vitest's own (which loads typescript for type tests).
describe("no eager typescript load", () => {
  it("importing @megasaver/output-filter does not load the typescript compiler", () => {
    // file:// URL (not a raw path) so import() works on Windows too —
    // an absolute path like "D:\\..." is rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(()=>{console.log(process.moduleLoadList.filter(m=>m.includes("node_modules/typescript")).length)})`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe("0");
  });
});
