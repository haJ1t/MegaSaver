import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Proxy Mode v1.2 §4 / §14-D8 README compliance. Kept light: assert the
// forbidden competitor headline is absent and the approved framing is present.
const readmePath = fileURLToPath(new URL("../../../README.md", import.meta.url));
const readme = readFileSync(readmePath, "utf8");

function headingLines(): string[] {
  return readme.split("\n").filter((line) => line.trimStart().startsWith("#"));
}

describe("README Proxy Mode compliance (D8)", () => {
  it("has no competitor-specific 'DFMT-style' headline", () => {
    for (const heading of headingLines()) {
      expect(heading.toLowerCase()).not.toContain("dfmt");
    }
  });

  it("uses the approved category-comparison one-liner", () => {
    expect(readme).toContain("Others prune output. Mega Saver prunes with your project's memory.");
  });

  it("explains Proxy Mode is opt-in", () => {
    expect(readme).toMatch(/Proxy Mode[\s\S]{0,400}opt-in/i);
  });
});
