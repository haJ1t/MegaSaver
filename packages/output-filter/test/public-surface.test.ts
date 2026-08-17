import { describe, expect, it } from "vitest";
import { chunkBySemantic } from "../src/index.js";

describe("public surface", () => {
  it("exposes chunkBySemantic and returns declaration-aligned chunks", async () => {
    const src =
      "export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n";
    const chunks = await chunkBySemantic(src, "sample.ts");
    expect(chunks).not.toBeNull();
    expect(chunks?.some((c) => c.text.includes("alpha"))).toBe(true);
  });

  it("returns null for an unsupported extension", async () => {
    expect(await chunkBySemantic("x", "sample.xyz")).toBeNull();
  });
});
