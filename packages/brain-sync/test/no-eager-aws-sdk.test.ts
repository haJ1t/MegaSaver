import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("no eager @aws-sdk load", () => {
  it("importing dist/index.js loads zero @aws-sdk modules", () => {
    const entryUrl = new URL("../dist/index.js", import.meta.url).href;
    const code = `import(${JSON.stringify(entryUrl)}).then(() => {
      const loaded = process.moduleLoadList.filter((m) => /node_modules[\\\\/]@aws-sdk[\\\\/]/.test(m));
      console.log(loaded.length);
    });`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
    });
    expect(out.trim()).toBe("0");
  });
});
