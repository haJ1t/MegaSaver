import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ESM adaptation: __dirname is undefined under vitest ESM, so resolve the
// views directory from import.meta.dirname (Node 22).
const VIEWS = join(import.meta.dirname, "..", "..", "src", "views");

// Documented page-root width set (spec section 4a + controller ruling):
// content pages max-w-5xl (max-w-[1024px] form accepted), data-dense
// Memory/Workspace pages max-w-6xl (max-w-[1152px] form accepted).
const ALLOWED_WIDTHS = new Set([
  "max-w-[1024px]",
  "max-w-[1152px]",
  "max-w-5xl",
  "max-w-6xl",
]);

describe("layout ratio system", () => {
  it("page roots use the documented width set", () => {
    const files = readdirSync(VIEWS).filter(
      (f) => f.endsWith("-page.tsx") || f.endsWith("-view.tsx"),
    );
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(VIEWS, f), "utf8");
      const widths = src.match(/max-w-(?:[[0-9]+px]|5xl|6xl)/g) ?? [];
      for (const w of widths) {
        if (!ALLOWED_WIDTHS.has(w)) bad.push(f + ":" + w);
      }
    }
    expect(bad).toEqual([]);
  });

  it("cards use rounded-xl, never rounded-2xl", () => {
    const files = readdirSync(VIEWS).filter((f) => f.endsWith(".tsx"));
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(VIEWS, f), "utf8");
      if (/rounded-2xl/.test(src)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});
