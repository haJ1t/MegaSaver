import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("no eager typescript load", () => {
  it("importing @megasaver/stats does not load the typescript compiler", () => {
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(()=>{console.log(process.moduleLoadList.filter(m=>m.includes("node_modules/typescript")).length)})`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe("0");
  });
});
