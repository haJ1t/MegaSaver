import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("no eager @aws-sdk load", () => {
  it("dist/index.js reaches @aws-sdk only via dynamic import", () => {
    const dist = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
    // The SDK must be reachable (via the lazy path inside createTransport):
    expect(dist).toMatch(/import\(\s*["']@aws-sdk\/client-s3["']\s*\)/);
    // ...and NEVER statically imported (a `... from "@aws-sdk/client-s3"` or a
    // bare side-effect `import "@aws-sdk/client-s3"` would load it at
    // module-eval time, bloating CLI cold-start + the standalone bundle).
    expect(dist).not.toMatch(/from\s*["']@aws-sdk\/client-s3["']/);
    expect(dist).not.toMatch(/^\s*import\s*["']@aws-sdk\/client-s3["']/m);
  });
});
