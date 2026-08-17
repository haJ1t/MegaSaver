import { describe, expect, it } from "vitest";
import { FALLBACK_WINDOW, enclosingExtents } from "../src/context-extents.js";

const LONG_FN = `export function gamma(): number {\n${"  // pad\n".repeat(120)}  return 3;\n}\n`;

describe("enclosingExtents", () => {
  it("returns the FULL enclosing declaration, not a sub-split slice", async () => {
    const extents = await enclosingExtents({
      path: "gamma.ts",
      headText: LONG_FN,
      ranges: [{ start: 60, end: 60 }],
    });
    expect(extents).toHaveLength(1);
    expect(extents[0]?.startLine).toBe(1);
    expect(extents[0]?.endLine).toBeGreaterThan(100); // whole 120+ line fn, unsplit
    expect(extents[0]?.name).toBe("gamma");
  });

  it("windows unsupported files around the hunk", async () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const extents = await enclosingExtents({
      path: "data.txt",
      headText: text,
      ranges: [{ start: 50, end: 50 }],
    });
    expect(extents[0]?.startLine).toBe(50 - FALLBACK_WINDOW);
    expect(extents[0]?.endLine).toBe(50 + FALLBACK_WINDOW);
  });
});
